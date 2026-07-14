use std::time::Duration;

use aws_config::{BehaviorVersion, Region};
use aws_credential_types::Credentials;
use aws_sdk_s3::{presigning::PresigningConfig, Client};
use thiserror::Error;

use crate::config::ObjectStorageConfig;

const PRESIGN_EXPIRES: Duration = Duration::from_secs(60 * 60);

#[derive(Clone, Debug)]
pub struct StorageClient {
    client: Client,
    bucket: String,
    prefix: String,
}

#[derive(Clone, Copy, Debug)]
pub struct AssetDefinition {
    pub id: &'static str,
    pub category: &'static str,
    pub label: &'static str,
    pub relative_key: &'static str,
    pub content_type: &'static str,
}

pub const GAME_ASSETS: &[AssetDefinition] = &[
    AssetDefinition {
        id: "tank-body",
        category: "models",
        label: "Tank body model",
        relative_key: "game-assets/models/tank-body.glb",
        content_type: "model/gltf-binary",
    },
    AssetDefinition {
        id: "tank-turret",
        category: "models",
        label: "Tank turret model",
        relative_key: "game-assets/models/tank-turret.glb",
        content_type: "model/gltf-binary",
    },
    AssetDefinition {
        id: "training-grounds",
        category: "terrain",
        label: "Training grounds terrain geometry",
        relative_key: "game-assets/terrain/training-grounds.glb",
        content_type: "model/gltf-binary",
    },
    AssetDefinition {
        id: "terrain-albedo",
        category: "textures",
        label: "Terrain albedo texture",
        relative_key: "game-assets/textures/terrain-albedo.webp",
        content_type: "image/webp",
    },
    AssetDefinition {
        id: "armor-normal",
        category: "textures",
        label: "Armor normal texture",
        relative_key: "game-assets/textures/armor-normal.webp",
        content_type: "image/webp",
    },
];

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("asset key must not be empty")]
    EmptyKey,
    #[error("asset key {key:?} is invalid")]
    InvalidKey { key: String },
    #[error("failed to create presigning configuration: {0}")]
    PresignConfig(String),
    #[error("failed to presign asset {key:?}: {message}")]
    Presign { key: String, message: String },
}

impl StorageClient {
    pub async fn from_config(config: &ObjectStorageConfig) -> Self {
        let credentials = Credentials::new(
            config.access_key_id.as_str(),
            config.secret_access_key.as_str(),
            None,
            None,
            "object-storage-env",
        );
        let sdk_config = aws_config::defaults(BehaviorVersion::latest())
            .region(Region::new(config.region.clone()))
            .endpoint_url(config.endpoint.clone())
            .credentials_provider(credentials)
            .load()
            .await;
        let s3_config = aws_sdk_s3::config::Builder::from(&sdk_config)
            .force_path_style(config.force_path_style)
            .build();

        Self {
            client: Client::from_conf(s3_config),
            bucket: config.bucket.clone(),
            prefix: config.prefix.clone(),
        }
    }

    pub async fn presigned_get_url(&self, relative_key: &str) -> Result<String, StorageError> {
        let full_key = self.full_key(relative_key)?;
        let presign_config = PresigningConfig::expires_in(PRESIGN_EXPIRES)
            .map_err(|error| StorageError::PresignConfig(error.to_string()))?;
        let request = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(&full_key)
            .presigned(presign_config)
            .await
            .map_err(|error| StorageError::Presign {
                key: full_key.clone(),
                message: error.to_string(),
            })?;

        Ok(request.uri().to_string())
    }

    pub fn presign_expires_in_seconds(&self) -> u64 {
        PRESIGN_EXPIRES.as_secs()
    }

    fn full_key(&self, relative_key: &str) -> Result<String, StorageError> {
        let key = relative_key.trim_start_matches('/');

        if key.is_empty() {
            return Err(StorageError::EmptyKey);
        }

        if key.contains("..") || key.contains('\\') {
            return Err(StorageError::InvalidKey {
                key: relative_key.to_owned(),
            });
        }

        Ok(format!("{}{}", self.prefix, key))
    }
}
