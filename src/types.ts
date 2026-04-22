/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type ElementType = 'point' | 'line' | 'shape' | 'image';
export type ShapeType = 'rectangle' | 'circle' | 'triangle';

export interface BaseElement {
  id: string;
  type: ElementType;
  x: number; // in meters
  y: number; // in meters
  rotation: number;
  scaleX: number;
  scaleY: number;
  color: string;
  opacity: number;
  name: string;
}

export interface PointElement extends BaseElement {
  type: 'point';
  radius: number; // visual size in pixels (scaled)
}

export interface LineElement extends BaseElement {
  type: 'line';
  points: number[]; // relative to x, y
  strokeWidth: number;
}

export interface ShapeElement extends BaseElement {
  type: 'shape';
  shapeType: ShapeType;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export interface ImageElement extends BaseElement {
  type: 'image';
  src: string;
  width: number;
  height: number;
}

export type SceneElement = PointElement | LineElement | ShapeElement | ImageElement;

export interface SceneState {
  elements: SceneElement[];
  background: {
    color: string;
    image?: string;
    width?: number;  // in meters
    height?: number; // in meters
    opacity?: number;
    gridVisible: boolean;
  };
}

export const INITIAL_STATE: SceneState = {
  elements: [],
  background: {
    color: '#ffffff',
    width: 20,
    height: 20,
    opacity: 1,
    gridVisible: true
  }
};
