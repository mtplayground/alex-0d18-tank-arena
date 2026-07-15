use std::{collections::HashMap, sync::Arc};

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::{broadcast, RwLock};

const MATCH_CHANNEL_CAPACITY: usize = 128;
const MAX_MATCH_ID_LEN: usize = 80;
const RECONNECT_GRACE_SECONDS: i64 = 90;
const ARENA_HALF_SIZE: f32 = 6.0;
const BASE_SHELL_DAMAGE: u16 = 100;
const FIRE_COOLDOWN_MILLIS: i64 = 650;
const MAX_CLIENT_SPEED: f32 = 7.0;
const MAX_FIRE_CONE_RADIANS: f32 = 0.35;
const MAX_FIRE_RANGE: f32 = 14.0;
const MAX_POSITION_GRACE: f32 = 0.45;
const MAX_TANK_MOVEMENT_SPEED: f32 = 5.0;
const POSITION_BOUNDARY_TOLERANCE: f32 = 0.35;
const TANK_EYE_HEIGHT: f32 = 0.72;
const TERRAIN_HEIGHT_TOLERANCE: f32 = 1.25;

#[derive(Clone, Default)]
pub struct MatchSessionRegistry {
    inner: Arc<RwLock<HashMap<String, MatchSession>>>,
}

impl MatchSessionRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn subscribe(
        &self,
        match_id: &str,
        user_sub: &str,
    ) -> Result<MatchSessionSubscription, MatchSessionError> {
        validate_match_id(match_id)?;

        let (
            sender,
            receiver,
            connection_count,
            connected_payload,
            presence_kind,
            presence_payload,
        ) = {
            let now = Utc::now();
            let mut sessions = self.inner.write().await;
            sessions.retain(|_, session| session.rejoin_available_at(now));

            let session = sessions.entry(match_id.to_owned()).or_insert_with(|| {
                let (sender, _) = broadcast::channel(MATCH_CHANNEL_CAPACITY);
                MatchSession {
                    connection_count: 0,
                    empty_since: None,
                    player_connections: HashMap::new(),
                    players: HashMap::new(),
                    sequence: 0,
                    sender,
                }
            });

            let resume_available = session.players.contains_key(user_sub);
            let previous_disconnect_at = session
                .player_connections
                .get(user_sub)
                .and_then(|connection| connection.disconnected_at);
            session.connection_count += 1;
            session.empty_since = None;
            session.sequence += 1;
            let sequence = session.sequence;

            let player_connection = session
                .player_connections
                .entry(user_sub.to_owned())
                .or_insert_with(PlayerConnectionState::default);
            player_connection.active_connections += 1;
            player_connection.connected_at = Some(now);
            player_connection.disconnected_at = None;

            let players = session.player_snapshot();
            let connections = session.connection_snapshot();
            let presence_kind = if previous_disconnect_at.is_some() || resume_available {
                "player_reconnected"
            } else {
                "player_joined"
            };
            let connected_payload = json!({
                "accepted_message_types": ["fire", "match_signal", "player_state"],
                "authoritative_message_types": ["fire", "player_state"],
                "connections": connections,
                "players": players,
                "reconnect_grace_seconds": RECONNECT_GRACE_SECONDS,
                "resume_available": resume_available,
                "sequence": sequence,
            });
            let presence_payload = json!({
                "connections": session.connection_snapshot(),
                "players": session.player_snapshot(),
                "previous_disconnect_at": previous_disconnect_at,
                "reconnect_grace_seconds": RECONNECT_GRACE_SECONDS,
                "resume_available": resume_available,
                "sequence": sequence,
            });

            (
                session.sender.clone(),
                session.sender.subscribe(),
                session.connection_count,
                connected_payload,
                presence_kind,
                presence_payload,
            )
        };

        let joined = MatchSocketEvent::new(
            presence_kind,
            match_id,
            user_sub,
            connection_count,
            presence_payload,
        )
        .to_message()?;
        let _ = sender.send(joined);

        Ok(MatchSessionSubscription {
            connection_count,
            connected_payload,
            match_id: match_id.to_owned(),
            receiver,
            sender,
            user_sub: user_sub.to_owned(),
        })
    }

    pub async fn disconnect(
        &self,
        match_id: &str,
        user_sub: &str,
    ) -> Result<(), MatchSessionError> {
        let (sender, connection_count, payload) = {
            let now = Utc::now();
            let mut sessions = self.inner.write().await;
            let Some(session) = sessions.get_mut(match_id) else {
                return Ok(());
            };

            session.connection_count = session.connection_count.saturating_sub(1);
            session.sequence += 1;
            let sequence = session.sequence;
            if session.connection_count == 0 {
                session.empty_since = Some(now);
            }

            if let Some(player_connection) = session.player_connections.get_mut(user_sub) {
                player_connection.active_connections =
                    player_connection.active_connections.saturating_sub(1);

                if player_connection.active_connections == 0 {
                    player_connection.disconnected_at = Some(now);
                }
            }

            let sender = session.sender.clone();
            let connection_count = session.connection_count;
            let payload = json!({
                "connections": session.connection_snapshot(),
                "players": session.player_snapshot(),
                "reconnect_deadline": reconnect_deadline(now),
                "reconnect_grace_seconds": RECONNECT_GRACE_SECONDS,
                "sequence": sequence,
            });

            (sender, connection_count, payload)
        };

        let left = MatchSocketEvent::new(
            "player_disconnected",
            match_id,
            user_sub,
            connection_count,
            payload,
        )
        .to_message()?;
        let _ = sender.send(left);

        Ok(())
    }

    pub async fn handle_client_message(
        &self,
        match_id: &str,
        user_sub: &str,
        text: &str,
    ) -> Result<String, MatchSessionError> {
        validate_match_id(match_id)?;

        let command = match serde_json::from_str::<ClientMatchCommand>(text) {
            Ok(command) => command,
            Err(_) => {
                return MatchSocketEvent::new(
                    "input_rejected",
                    match_id,
                    user_sub,
                    0,
                    json!({ "reason": "message must be a recognized match command" }),
                )
                .to_message();
            }
        };

        let mut sessions = self.inner.write().await;
        let Some(session) = sessions.get_mut(match_id) else {
            return MatchSocketEvent::new(
                "input_rejected",
                match_id,
                user_sub,
                0,
                json!({ "reason": "match session is not active" }),
            )
            .to_message();
        };

        session.sequence += 1;
        let sequence = session.sequence;
        let connection_count = session.connection_count;
        let now = Utc::now();

        match command {
            ClientMatchCommand::PlayerState {
                client_tick,
                heading,
                position,
                speed,
                turret_heading,
            } => {
                if let Err(reason) =
                    validate_tank_state(position, heading, turret_heading, speed)
                        .and_then(|_| session.validate_movement(user_sub, position, now))
                {
                    return MatchSocketEvent::new(
                        "input_rejected",
                        match_id,
                        user_sub,
                        connection_count,
                        json!({
                            "client_tick": client_tick,
                            "reason": reason,
                            "sequence": sequence,
                        }),
                    )
                    .to_message();
                }

                let health = session
                    .players
                    .get(user_sub)
                    .map(|player| player.health)
                    .unwrap_or(BASE_SHELL_DAMAGE);
                let last_fire_at = session
                    .players
                    .get(user_sub)
                    .and_then(|player| player.last_fire_at);

                session.players.insert(
                    user_sub.to_owned(),
                    AuthoritativeTankState {
                        health,
                        heading: normalize_radians(heading),
                        last_fire_at,
                        position,
                        speed,
                        turret_heading: normalize_radians(turret_heading),
                        updated_at: now,
                        user_sub: user_sub.to_owned(),
                    },
                );

                MatchSocketEvent::new(
                    "state_update",
                    match_id,
                    user_sub,
                    connection_count,
                    json!({
                        "client_tick": client_tick,
                        "players": session.player_snapshot(),
                        "sequence": sequence,
                    }),
                )
                .to_message()
            }
            ClientMatchCommand::Fire {
                client_tick,
                shot_id,
            } => {
                let result = session.resolve_fire(match_id, user_sub, shot_id, client_tick, now);
                MatchSocketEvent::new(
                    "shot_resolved",
                    match_id,
                    user_sub,
                    connection_count,
                    json!({
                        "players": session.player_snapshot(),
                        "result": result,
                        "sequence": sequence,
                    }),
                )
                .to_message()
            }
            ClientMatchCommand::MatchSignal { payload, signal } => MatchSocketEvent::new(
                "match_signal",
                match_id,
                user_sub,
                connection_count,
                json!({
                    "payload": payload.unwrap_or(Value::Null),
                    "sequence": sequence,
                    "signal": signal,
                }),
            )
            .to_message(),
        }
    }
}

#[derive(Debug)]
pub struct MatchSessionSubscription {
    pub connection_count: usize,
    pub connected_payload: Value,
    pub match_id: String,
    pub receiver: broadcast::Receiver<String>,
    pub sender: broadcast::Sender<String>,
    pub user_sub: String,
}

impl MatchSessionSubscription {
    pub fn connected_message(&self) -> Result<String, MatchSessionError> {
        MatchSocketEvent::new(
            "session_connected",
            &self.match_id,
            &self.user_sub,
            self.connection_count,
            self.connected_payload.clone(),
        )
        .to_message()
    }

    pub fn player_message(&self, payload: Value) -> Result<String, MatchSessionError> {
        MatchSocketEvent::new(
            "player_message",
            &self.match_id,
            &self.user_sub,
            self.connection_count,
            payload,
        )
        .to_message()
    }

    pub fn error_message(&self, reason: &'static str) -> Result<String, MatchSessionError> {
        MatchSocketEvent::new(
            "session_error",
            &self.match_id,
            &self.user_sub,
            self.connection_count,
            json!({ "reason": reason }),
        )
        .to_message()
    }
}

pub fn validate_match_id(match_id: &str) -> Result<(), MatchSessionError> {
    let valid = !match_id.is_empty()
        && match_id.len() <= MAX_MATCH_ID_LEN
        && match_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'));

    if valid {
        Ok(())
    } else {
        Err(MatchSessionError::InvalidMatchId)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum MatchSessionError {
    #[error("match id is invalid")]
    InvalidMatchId,
    #[error("match socket event serialization failed")]
    Serialize(#[from] serde_json::Error),
}

#[derive(Clone)]
struct MatchSession {
    connection_count: usize,
    empty_since: Option<DateTime<Utc>>,
    player_connections: HashMap<String, PlayerConnectionState>,
    players: HashMap<String, AuthoritativeTankState>,
    sequence: u64,
    sender: broadcast::Sender<String>,
}

impl MatchSession {
    fn connection_snapshot(&self) -> Vec<PlayerConnectionSnapshot> {
        let mut connections: Vec<_> = self
            .player_connections
            .iter()
            .map(|(user_sub, connection)| {
                let connected = connection.active_connections > 0;

                PlayerConnectionSnapshot {
                    active_connections: connection.active_connections,
                    connected,
                    connected_at: connection.connected_at,
                    disconnected_at: connection.disconnected_at,
                    reconnect_deadline: connection.disconnected_at.map(reconnect_deadline),
                    user_sub: user_sub.clone(),
                }
            })
            .collect();
        connections.sort_by(|left, right| left.user_sub.cmp(&right.user_sub));
        connections
    }

    fn player_snapshot(&self) -> Vec<AuthoritativeTankState> {
        let mut players: Vec<_> = self.players.values().cloned().collect();
        players.sort_by(|left, right| left.user_sub.cmp(&right.user_sub));
        players
    }

    fn rejoin_available_at(&self, now: DateTime<Utc>) -> bool {
        self.connection_count > 0
            || self
                .empty_since
                .map(|empty_since| now.signed_duration_since(empty_since).num_seconds())
                .is_some_and(|elapsed_seconds| elapsed_seconds <= RECONNECT_GRACE_SECONDS)
    }

    fn resolve_fire(
        &mut self,
        match_id: &str,
        user_sub: &str,
        shot_id: Option<String>,
        client_tick: Option<u64>,
        now: DateTime<Utc>,
    ) -> FireResolution {
        let Some(shooter) = self.players.get(user_sub).cloned() else {
            return FireResolution::rejected(
                match_id,
                user_sub,
                shot_id,
                client_tick,
                "player state required before firing",
            );
        };

        if let Some(last_fire_at) = shooter.last_fire_at {
            let elapsed = now.signed_duration_since(last_fire_at).num_milliseconds();
            if elapsed < FIRE_COOLDOWN_MILLIS {
                return FireResolution::rejected(
                    match_id,
                    user_sub,
                    shot_id,
                    client_tick,
                    "weapon cooling down",
                );
            }
        }

        if let Some(shooter_state) = self.players.get_mut(user_sub) {
            shooter_state.last_fire_at = Some(now);
        }

        let Some(target) = self
            .players
            .values()
            .find(|player| player.user_sub != user_sub && player.health > 0)
            .cloned()
        else {
            return FireResolution {
                armor: None,
                client_tick,
                damage: None,
                hit: false,
                match_id: match_id.to_owned(),
                reason: Some("no target in session"),
                shot_id,
                shooter_sub: user_sub.to_owned(),
                target_health: None,
                target_sub: None,
            };
        };

        let distance = horizontal_distance(shooter.position, target.position);
        if distance > MAX_FIRE_RANGE {
            return FireResolution::missed(
                match_id,
                user_sub,
                shot_id,
                client_tick,
                Some(target.user_sub),
                "target out of range",
            );
        }

        let target_bearing = bearing_to_point(shooter.position, target.position);
        let aim_error = absolute_angle_difference(shooter.turret_heading, target_bearing);
        if aim_error > MAX_FIRE_CONE_RADIANS {
            return FireResolution::missed(
                match_id,
                user_sub,
                shot_id,
                client_tick,
                Some(target.user_sub),
                "turret is not aligned with target",
            );
        }

        let armor = calculate_armor_angle(&shooter, &target);
        let damage = calculate_damage_mitigation(&armor);
        let target_health = self
            .players
            .get_mut(&target.user_sub)
            .map(|target_state| {
                target_state.health = target_state.health.saturating_sub(damage.final_damage);
                target_state.health
            })
            .unwrap_or(target.health);

        FireResolution {
            armor: Some(armor),
            client_tick,
            damage: Some(damage),
            hit: true,
            match_id: match_id.to_owned(),
            reason: None,
            shot_id,
            shooter_sub: user_sub.to_owned(),
            target_health: Some(target_health),
            target_sub: Some(target.user_sub),
        }
    }

    fn validate_movement(
        &self,
        user_sub: &str,
        position: [f32; 3],
        now: DateTime<Utc>,
    ) -> Result<(), &'static str> {
        let Some(previous) = self.players.get(user_sub) else {
            return Ok(());
        };

        let elapsed = now
            .signed_duration_since(previous.updated_at)
            .num_milliseconds()
            .max(1) as f32
            / 1000.0;
        let max_distance = MAX_TANK_MOVEMENT_SPEED * elapsed + MAX_POSITION_GRACE;
        let moved = horizontal_distance(previous.position, position);

        if moved > max_distance {
            Err("movement exceeds authoritative speed limit")
        } else {
            Ok(())
        }
    }
}

#[derive(Clone, Debug, Default)]
struct PlayerConnectionState {
    active_connections: usize,
    connected_at: Option<DateTime<Utc>>,
    disconnected_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
struct PlayerConnectionSnapshot {
    active_connections: usize,
    connected: bool,
    connected_at: Option<DateTime<Utc>>,
    disconnected_at: Option<DateTime<Utc>>,
    reconnect_deadline: Option<DateTime<Utc>>,
    user_sub: String,
}

#[derive(Clone, Debug, Serialize)]
struct AuthoritativeTankState {
    health: u16,
    heading: f32,
    last_fire_at: Option<DateTime<Utc>>,
    position: [f32; 3],
    speed: f32,
    turret_heading: f32,
    updated_at: DateTime<Utc>,
    user_sub: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientMatchCommand {
    Fire {
        client_tick: Option<u64>,
        shot_id: Option<String>,
    },
    MatchSignal {
        payload: Option<Value>,
        signal: String,
    },
    PlayerState {
        client_tick: Option<u64>,
        heading: f32,
        position: [f32; 3],
        speed: f32,
        #[serde(alias = "turretHeading")]
        turret_heading: f32,
    },
}

#[derive(Debug, Serialize)]
struct FireResolution {
    armor: Option<ArmorAngleReading>,
    client_tick: Option<u64>,
    damage: Option<DamageMitigation>,
    hit: bool,
    match_id: String,
    reason: Option<&'static str>,
    shot_id: Option<String>,
    shooter_sub: String,
    target_health: Option<u16>,
    target_sub: Option<String>,
}

impl FireResolution {
    fn missed(
        match_id: &str,
        user_sub: &str,
        shot_id: Option<String>,
        client_tick: Option<u64>,
        target_sub: Option<String>,
        reason: &'static str,
    ) -> Self {
        Self {
            armor: None,
            client_tick,
            damage: None,
            hit: false,
            match_id: match_id.to_owned(),
            reason: Some(reason),
            shot_id,
            shooter_sub: user_sub.to_owned(),
            target_health: None,
            target_sub,
        }
    }

    fn rejected(
        match_id: &str,
        user_sub: &str,
        shot_id: Option<String>,
        client_tick: Option<u64>,
        reason: &'static str,
    ) -> Self {
        Self {
            armor: None,
            client_tick,
            damage: None,
            hit: false,
            match_id: match_id.to_owned(),
            reason: Some(reason),
            shot_id,
            shooter_sub: user_sub.to_owned(),
            target_health: None,
            target_sub: None,
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
enum ArmorFacing {
    Angled,
    Front,
    Rear,
    Side,
}

#[derive(Debug, Serialize)]
struct ArmorAngleReading {
    hull_angle_degrees: u16,
    hull_facing: ArmorFacing,
    threat_bearing_degrees: i16,
    turret_angle_degrees: u16,
    turret_facing: ArmorFacing,
}

#[derive(Debug, Serialize)]
struct DamageMitigation {
    armor_angle_degrees: u16,
    base_damage: u16,
    final_damage: u16,
    mitigation_percent: u16,
    outcome: &'static str,
    rule_label: &'static str,
}

fn validate_tank_state(
    position: [f32; 3],
    heading: f32,
    turret_heading: f32,
    speed: f32,
) -> Result<(), &'static str> {
    if !position.iter().all(|coordinate| coordinate.is_finite())
        || !heading.is_finite()
        || !turret_heading.is_finite()
        || !speed.is_finite()
    {
        return Err("tank state contains non-finite values");
    }

    if position[0].abs() > ARENA_HALF_SIZE + POSITION_BOUNDARY_TOLERANCE
        || position[2].abs() > ARENA_HALF_SIZE + POSITION_BOUNDARY_TOLERANCE
    {
        return Err("tank position is outside the arena");
    }

    let expected_height = terrain_height(position[0], position[2]) + TANK_EYE_HEIGHT;
    if (position[1] - expected_height).abs() > TERRAIN_HEIGHT_TOLERANCE {
        return Err("tank height does not match the battlefield");
    }

    if speed.abs() > MAX_CLIENT_SPEED {
        return Err("reported tank speed is outside allowed limits");
    }

    Ok(())
}

fn calculate_armor_angle(
    shooter: &AuthoritativeTankState,
    target: &AuthoritativeTankState,
) -> ArmorAngleReading {
    let threat_bearing = bearing_to_point(target.position, shooter.position);
    let hull_angle_degrees = radians_to_degrees(absolute_angle_difference(
        target.heading,
        threat_bearing,
    ))
    .round() as u16;
    let turret_angle_degrees = radians_to_degrees(absolute_angle_difference(
        target.turret_heading,
        threat_bearing,
    ))
    .round() as u16;

    ArmorAngleReading {
        hull_angle_degrees,
        hull_facing: classify_armor_facing(hull_angle_degrees),
        threat_bearing_degrees: radians_to_degrees(normalize_radians(threat_bearing)).round()
            as i16,
        turret_angle_degrees,
        turret_facing: classify_armor_facing(turret_angle_degrees),
    }
}

fn calculate_damage_mitigation(armor: &ArmorAngleReading) -> DamageMitigation {
    let raw_mitigation = mitigation_for_facing(armor.hull_facing, armor.hull_angle_degrees);
    let outcome = outcome_for_mitigation(
        armor.hull_facing,
        armor.hull_angle_degrees,
        raw_mitigation,
    );
    let mitigation_percent = if outcome == "deflected" {
        100
    } else {
        raw_mitigation.round() as u16
    };
    let final_damage = if outcome == "deflected" {
        0
    } else {
        (BASE_SHELL_DAMAGE as f32 * (1.0 - raw_mitigation / 100.0))
            .round()
            .max(0.0) as u16
    };

    DamageMitigation {
        armor_angle_degrees: armor.hull_angle_degrees,
        base_damage: BASE_SHELL_DAMAGE,
        final_damage,
        mitigation_percent,
        outcome,
        rule_label: label_for_outcome(outcome),
    }
}

fn mitigation_for_facing(facing: ArmorFacing, angle_degrees: u16) -> f32 {
    let angle_degrees = f32::from(angle_degrees);

    match facing {
        ArmorFacing::Front => interpolate(angle_degrees, 0.0, 30.0, 12.0, 28.0),
        ArmorFacing::Angled => {
            if angle_degrees >= 58.0 {
                100.0
            } else {
                interpolate(angle_degrees, 31.0, 57.0, 36.0, 64.0)
            }
        }
        ArmorFacing::Side => interpolate((angle_degrees - 90.0).abs(), 0.0, 25.0, 6.0, 18.0),
        ArmorFacing::Rear => 0.0,
    }
}

fn interpolate(
    value: f32,
    input_min: f32,
    input_max: f32,
    output_min: f32,
    output_max: f32,
) -> f32 {
    let t = ((value - input_min) / (input_max - input_min)).clamp(0.0, 1.0);

    output_min + (output_max - output_min) * t
}

fn outcome_for_mitigation(
    facing: ArmorFacing,
    angle_degrees: u16,
    mitigation_percent: f32,
) -> &'static str {
    if matches!(facing, ArmorFacing::Angled) && angle_degrees >= 58 {
        return "deflected";
    }

    if mitigation_percent >= 45.0 {
        "glancing"
    } else if mitigation_percent >= 15.0 {
        "reduced"
    } else {
        "clean hit"
    }
}

fn label_for_outcome(outcome: &str) -> &'static str {
    match outcome {
        "deflected" => "No damage",
        "glancing" => "Glancing",
        "reduced" => "Reduced",
        _ => "Clean",
    }
}

fn classify_armor_facing(angle_degrees: u16) -> ArmorFacing {
    if angle_degrees <= 30 {
        ArmorFacing::Front
    } else if angle_degrees <= 65 {
        ArmorFacing::Angled
    } else if angle_degrees <= 115 {
        ArmorFacing::Side
    } else {
        ArmorFacing::Rear
    }
}

fn bearing_to_point(from: [f32; 3], to: [f32; 3]) -> f32 {
    (to[0] - from[0]).atan2(-(to[2] - from[2]))
}

fn absolute_angle_difference(left: f32, right: f32) -> f32 {
    normalize_radians(right - left).abs()
}

fn normalize_radians(value: f32) -> f32 {
    let mut next_value = value;

    while next_value <= -std::f32::consts::PI {
        next_value += std::f32::consts::PI * 2.0;
    }

    while next_value > std::f32::consts::PI {
        next_value -= std::f32::consts::PI * 2.0;
    }

    next_value
}

fn radians_to_degrees(value: f32) -> f32 {
    (value * 180.0) / std::f32::consts::PI
}

fn horizontal_distance(left: [f32; 3], right: [f32; 3]) -> f32 {
    ((right[0] - left[0]).powi(2) + (right[2] - left[2]).powi(2)).sqrt()
}

fn terrain_height(x: f32, z: f32) -> f32 {
    let ridge_a = (-(z + 1.6 + (x * 0.7).sin() * 0.5).abs()).exp() * 0.48;
    let ridge_b = (-(z - 1.4 - (x * 0.55).cos() * 0.6).abs()).exp() * 0.38;
    let broken_ground = (x * 1.7).sin() * (z * 1.35).cos() * 0.08;
    let crater = (-((x + 1.2).powi(2) + (z - 0.6).powi(2)) / 1.4).exp() * -0.42;

    ridge_a + ridge_b + broken_ground + crater - 0.1
}

fn reconnect_deadline(disconnected_at: DateTime<Utc>) -> DateTime<Utc> {
    disconnected_at + Duration::seconds(RECONNECT_GRACE_SECONDS)
}

#[derive(Debug, Serialize)]
struct MatchSocketEvent {
    connection_count: usize,
    kind: &'static str,
    match_id: String,
    payload: Value,
    server_time: DateTime<Utc>,
    user_sub: String,
}

impl MatchSocketEvent {
    fn new(
        kind: &'static str,
        match_id: &str,
        user_sub: &str,
        connection_count: usize,
        payload: Value,
    ) -> Self {
        Self {
            connection_count,
            kind,
            match_id: match_id.to_owned(),
            payload,
            server_time: Utc::now(),
            user_sub: user_sub.to_owned(),
        }
    }

    fn to_message(&self) -> Result<String, MatchSessionError> {
        Ok(serde_json::to_string(self)?)
    }
}
