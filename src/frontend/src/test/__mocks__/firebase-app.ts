import { vi } from 'vitest';

export const initializeApp = vi.fn();
export const getApps = vi.fn(() => []);
export const getApp = vi.fn();

export const getMessaging = vi.fn();
export const getToken = vi.fn();
