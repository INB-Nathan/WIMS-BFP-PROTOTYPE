import { describe, expect, it, vi } from 'vitest';

const dynamicMock = vi.hoisted(() => vi.fn(() => () => null));

vi.mock('next/dynamic', () => ({ default: dynamicMock }));

import RouteMap from '../RouteMap';

describe('RouteMap wrapper', () => {
  it('loads the Leaflet implementation with SSR disabled', () => {
    expect(RouteMap).toBeTypeOf('function');
    expect(dynamicMock).toHaveBeenCalledOnce();
    expect(dynamicMock.mock.calls[0][1]).toMatchObject({ ssr: false });
  });
});
