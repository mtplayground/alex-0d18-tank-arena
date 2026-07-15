import { terrainHeight, type Vec3 } from './battlefield';

export type TankPose = {
  position: Vec3;
  heading: number;
  speed: number;
  turretHeading: number;
};

export const TANK_EYE_HEIGHT = 0.72;

export function createInitialTankPose(): TankPose {
  return {
    position: [-1.7, terrainHeight(-1.7, 2.15) + TANK_EYE_HEIGHT, 2.15],
    heading: -0.7,
    speed: 0,
    turretHeading: -0.7,
  };
}
