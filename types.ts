/**
 * Shared Type Definitions for Spatial Finger Tracker
 */

export interface Point {
  x: number;
  y: number;
}

export type TrackingStatus = 'NO TV' | 'TRACKING' | 'LOST';

export interface WebSocketAimMessage {
  type: 'aim';
  x: number;
  y: number;
}

export interface WebSocketLostMessage {
  type: 'lost';
}

export interface WebSocketFireMessage {
  type: 'fire';
}

export interface WebSocketResultMessage {
  type: 'result';
  hit: boolean;
  score: number;
  shots: number;
}

export interface WebSocketPingMessage {
  type: 'ping';
  t: number;
}

export interface WebSocketPongMessage {
  type: 'pong';
  t: number;
}

export type OutgoingWebSocketMessage =
  | WebSocketAimMessage
  | WebSocketLostMessage
  | WebSocketFireMessage
  | WebSocketPingMessage;

export type IncomingWebSocketMessage =
  | WebSocketResultMessage
  | WebSocketPongMessage
  | { [key: string]: any };
