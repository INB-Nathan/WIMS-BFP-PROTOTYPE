import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockRouter = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => mockRouter }));

vi.mock('next/dynamic', () => ({
  default: () => function MockMapPicker() { return <div data-testid="map-picker" />; },
}));

vi.mock('sonner', () => ({ toast: { info: vi.fn() } }));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    loading: false,
    user: { id: 'encoder-1', role: 'REGIONAL_ENCODER', assignedRegionId: 1 },
  }),
}));

vi.mock('@/lib/connectivity', () => ({
  isReachable: vi.fn().mockResolvedValue(false),
  markConnectivityOffline: vi.fn(),
}));

vi.mock('@/lib/edgeFunctions', () => ({
  edgeFunctions: { uploadBundle: vi.fn() },
}));

vi.mock('@/lib/api', () => ({
  updateRegionalIncident: vi.fn(),
  forceReplaceIncident: vi.fn(),
  createRegionalIncident: vi.fn(),
  submitIncidentForReview: vi.fn(),
  ApiRequestError: class ApiRequestError extends Error {
    status: number;
    detail: unknown;
    constructor(status: number, detail?: unknown) {
      super(`Request failed: ${status}`);
      this.status = status;
      this.detail = detail;
    }
  },
}));

const mockOfflineStore = vi.hoisted(() => ({
  queueOfflineOp: vi.fn().mockResolvedValue(undefined),
  saveDraftOp: vi.fn().mockResolvedValue(undefined),
  getDraftOps: vi.fn().mockResolvedValue([]),
  deleteOfflineOp: vi.fn().mockResolvedValue(undefined),
  updateOfflineOp: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/offlineStore', () => mockOfflineStore);

vi.mock('@/lib/geocode', () => ({ reverseGeocode: vi.fn() }));
vi.mock('@/lib/formDirty', () => ({ setFormDirty: vi.fn(), isFormDirty: vi.fn(() => false) }));

vi.mock('@/components/SectionDotNav', () => ({
  SectionDotNav: () => <nav data-testid="section-dot-nav" />,
}));

vi.mock('../IncidentFormSections', () => ({
  AssetsResourcesSection: () => <div data-testid="assets-section" />,
  AlarmLevelSection: () => <div data-testid="alarm-section" />,
  CasualtiesSection: () => <div data-testid="casualties-section" />,
  PersonnelOnDutySection: () => <div data-testid="personnel-section" />,
  ProblemsChecklistSection: () => <div data-testid="problems-section" />,
}));

import { IncidentForm } from '../IncidentForm';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.spyOn(Math, 'random').mockReturnValue(0);
  vi.spyOn(crypto, 'randomUUID')
    .mockReturnValueOnce('create-local-id' as `${string}-${string}-${string}-${string}-${string}`)
    .mockReturnValueOnce('submit-local-id' as `${string}-${string}-${string}-${string}-${string}`)
    .mockReturnValueOnce('next-draft-local-id' as `${string}-${string}-${string}-${string}-${string}`);
  localStorage.clear();
});

async function fillRequiredValidForm(container: HTMLElement) {
  await userEvent.click(screen.getByRole('button', { name: /auto-fill/i }));
  await userEvent.selectOptions(container.querySelectorAll('select')[1], 'Fire District 5');
  await waitFor(() => expect(screen.getByRole('option', { name: 'Quezon City' })).toBeInTheDocument());
  await userEvent.selectOptions(screen.getByRole('option', { name: 'Quezon City' }).closest('select') as HTMLSelectElement, 'Quezon City');
  await userEvent.selectOptions(container.querySelector('select[name="type_of_involved_general_category"]') as HTMLSelectElement, 'Single and Two Family Dwelling');
}

describe('IncidentForm offline create behavior', () => {
  it('queues a create op and redirects to the regional dashboard when saving offline', async () => {
    const { container } = render(<IncidentForm />);

    await fillRequiredValidForm(container);
    await userEvent.click(screen.getByRole('button', { name: /save as draft/i }));

    await waitFor(() => expect(mockOfflineStore.queueOfflineOp).toHaveBeenCalledWith(expect.objectContaining({
      localId: 'create-local-id',
      operation: 'create',
      serverId: null,
      linkedLocalId: null,
      regionId: 1,
      encoderId: 'encoder-1',
    })));

    expect(mockOfflineStore.queueOfflineOp).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).toHaveBeenCalledWith('/dashboard/regional');
  });

  it('queues create and linked submit ops when submitting for review offline', async () => {
    const { container } = render(<IncidentForm />);

    await fillRequiredValidForm(container);
    await userEvent.click(screen.getByRole('button', { name: /submit for review/i }));

    await waitFor(() => expect(mockOfflineStore.queueOfflineOp).toHaveBeenCalledTimes(2));
    expect(mockOfflineStore.queueOfflineOp).toHaveBeenNthCalledWith(1, expect.objectContaining({
      localId: 'create-local-id',
      operation: 'create',
      serverId: null,
      linkedLocalId: null,
      regionId: 1,
      encoderId: 'encoder-1',
    }));
    expect(mockOfflineStore.queueOfflineOp).toHaveBeenNthCalledWith(2, expect.objectContaining({
      localId: 'submit-local-id',
      operation: 'submit',
      serverId: null,
      linkedLocalId: 'create-local-id',
      regionId: 1,
      encoderId: 'encoder-1',
    }));
    expect(mockRouter.push).toHaveBeenCalledWith('/dashboard/regional');
  });
});
