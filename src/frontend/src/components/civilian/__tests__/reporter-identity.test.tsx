import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ReporterIdentityFields,
  reporterIdentityComplete,
} from '../ReporterIdentityFields';

describe('reporter identity UX', () => {
  it('requires anonymous name and normal-report phone', () => {
    expect(reporterIdentityComplete(false, '', '', 'UNKNOWN')).toBe(false);
    expect(reporterIdentityComplete(false, 'Juan', '', 'I_AM_SAFE')).toBe(false);
    expect(reporterIdentityComplete(false, 'Juan', '09171234567', 'I_AM_SAFE')).toBe(true);
  });

  it('allows life-safety phone omission but still requires name', () => {
    expect(reporterIdentityComplete(false, '', '', 'I_NEED_HELP')).toBe(false);
    expect(reporterIdentityComplete(false, 'Juan', '', 'I_NEED_HELP')).toBe(true);
    expect(reporterIdentityComplete(false, 'Juan', '', 'SOMEONE_ELSE_NEEDS_HELP')).toBe(true);
  });

  it('shows no duplicate identity inputs for authenticated civilian reporters', () => {
    render(
      <ReporterIdentityFields
        authenticatedCivilian
        reporterName=""
        reporterPhone=""
        safetyStatus="UNKNOWN"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('profile-reporter-identity')).toHaveTextContent(
      'Your account profile will identify you as reporter',
    );
    expect(screen.queryByLabelText(/Reporter name/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Reporter phone/)).not.toBeInTheDocument();
  });

  it('keeps reporter controls explicitly separate from direct eyewitness details', () => {
    const onChange = vi.fn();
    render(
      <ReporterIdentityFields
        authenticatedCivilian={false}
        reporterName=""
        reporterPhone=""
        safetyStatus="UNKNOWN"
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Reporter name/), { target: { value: 'Juan' } });
    expect(onChange).toHaveBeenCalledWith({ reporterName: 'Juan', reporterPhone: '' });
    expect(screen.getByText(/not necessarily direct eyewitness/)).toBeInTheDocument();
  });
});
