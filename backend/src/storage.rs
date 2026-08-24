use thiserror::Error;

use crate::config::ObjectStorageConfig;

const PRESIGN_EXPIRES_IN_SECONDS: u64 = 60 * 60;

#[derive(Clone, Debug)]
pub struct StorageClient;

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
    #[error("object storage is not configured")]
    Unavailable,
}

impl StorageClient {
    pub async fn from_config(_: &ObjectStorageConfig) -> Self {
        Self
    }

    pub async fn presigned_get_url(&self, _: &str) -> Result<String, StorageError> {
        Err(StorageError::Unavailable)
    }

    pub fn presign_expires_in_seconds(&self) -> u64 {
        PRESIGN_EXPIRES_IN_SECONDS
    }
}
