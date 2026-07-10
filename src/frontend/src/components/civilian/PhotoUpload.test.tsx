import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { PhotoUpload, type PhotoGpsSample } from './PhotoUpload';

// ── Geolocation mock ────────────────────────────────────────────────────────
function mockGeolocation(
  errorCode: number = 0,
  coords?: { latitude: number; longitude: number; accuracy?: number },
) {
  const getCurrentPosition = vi.fn().mockImplementation((successFn, errorFn) => {
    if (errorCode === 0 && coords) {
      successFn({
        coords: {
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: coords.accuracy ?? 10,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
        timestamp: Date.now(),
      });
    } else if (errorCode > 0) {
      const err = {
        code: errorCode,
        message: ['denied', 'unavailable', 'timeout'][errorCode - 1] ?? 'error',
      };
      errorFn(err);
    }
  });
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    value: { getCurrentPosition },
    writable: true,
    configurable: true,
  });
  return getCurrentPosition;
}

function removeGeolocation() {
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    value: undefined,
    writable: true,
    configurable: true,
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function createFile(name: string, type: string, sizeBytes: number): File {
  const blob = new Blob([new Uint8Array(sizeBytes)], { type });
  return new File([blob], name, { type });
}

const jpegFile = (size = 1024) => createFile('photo.jpg', 'image/jpeg', size);
const pngFile = (size = 1024) => createFile('photo.png', 'image/png', size);
const bigFile = (size = 6 * 1024 * 1024) => createFile('big.jpg', 'image/jpeg', size);
const gifFile = () => createFile('photo.gif', 'image/gif', 1024);

// ── Tests ────────────────────────────────────────────────────────────────────

describe('PhotoUpload', () => {
  const defaultProps = {
    file: null as File | null,
    onFileChange: vi.fn(),
    gps: null as PhotoGpsSample | null,
    onGpsChange: vi.fn(),
    disabled: false,
    photoStatus: 'idle' as const,
    photoError: null as string | null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Set up geolocation by default (success with valid coords)
    mockGeolocation(0, { latitude: 14.5, longitude: 121.0, accuracy: 10 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Rendering ────────────────────────────────────────────────────────────

  it('renders file input with accept image/jpeg and image/png', () => {
    render(<PhotoUpload {...defaultProps} />);
    const input = screen.getByTestId('photo-file-input');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('accept', 'image/jpeg,image/png');
    expect(input).toHaveAttribute('type', 'file');
  });

  it('shows label when no file is selected', () => {
    render(<PhotoUpload {...defaultProps} />);
    expect(screen.getByText('Tap to select a photo')).toBeInTheDocument();
    expect(screen.getByText('JPEG or PNG only')).toBeInTheDocument();
  });

  // ── File type validation ─────────────────────────────────────────────────

  it('rejects non-JPEG/PNG file types', async () => {
    const onFileChange = vi.fn();
    render(<PhotoUpload {...defaultProps} onFileChange={onFileChange} />);

    const input = screen.getByTestId('photo-file-input');
    const file = gifFile();
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    expect(onFileChange).toHaveBeenCalledWith(null);
    expect(screen.getByText('Please select a JPEG or PNG image.')).toBeInTheDocument();
  });

  it('accepts JPEG file', async () => {
    const onFileChange = vi.fn();
    render(<PhotoUpload {...defaultProps} onFileChange={onFileChange} />);

    const input = screen.getByTestId('photo-file-input');
    const file = jpegFile();
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    expect(onFileChange).toHaveBeenCalledWith(file);
  });

  it('accepts PNG file', async () => {
    const onFileChange = vi.fn();
    render(<PhotoUpload {...defaultProps} onFileChange={onFileChange} />);

    const input = screen.getByTestId('photo-file-input');
    const file = pngFile();
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    expect(onFileChange).toHaveBeenCalledWith(file);
  });

  // ── File size validation ─────────────────────────────────────────────────

  it('rejects files larger than 5 MiB', async () => {
    const onFileChange = vi.fn();
    render(<PhotoUpload {...defaultProps} onFileChange={onFileChange} />);

    const input = screen.getByTestId('photo-file-input');
    const file = bigFile();
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    expect(onFileChange).toHaveBeenCalledWith(null);
    expect(screen.getByText('Photo must be under 5 MB.')).toBeInTheDocument();
  });

  // ── Remove / replace ─────────────────────────────────────────────────────

  it('remove button clears the file and GPS', async () => {
    const onFileChange = vi.fn();
    const onGpsChange = vi.fn();
    const file = jpegFile();
    render(
      <PhotoUpload
        {...defaultProps}
        file={file}
        onFileChange={onFileChange}
        onGpsChange={onGpsChange}
        gps={{ latitude: 14.5, longitude: 121.0, accuracy: 10, capturedAt: '2026-07-10T00:00:00.000Z' }}
      />,
    );

    const removeBtn = screen.getByTestId('photo-remove-btn');
    await act(async () => {
      fireEvent.click(removeBtn);
    });

    expect(onFileChange).toHaveBeenCalledWith(null);
    expect(onGpsChange).toHaveBeenCalledWith(null);
  });

  it('remove button is hidden when photo is uploaded', () => {
    render(
      <PhotoUpload
        {...defaultProps}
        file={jpegFile()}
        photoStatus="uploaded"
      />,
    );
    expect(screen.queryByTestId('photo-remove-btn')).not.toBeInTheDocument();
  });

  // ── Disabled state ───────────────────────────────────────────────────────

  it('disables file input when disabled prop is true', () => {
    render(<PhotoUpload {...defaultProps} disabled={true} />);
    const input = screen.getByTestId('photo-file-input');
    expect(input).toBeDisabled();
  });

  it('disables file input while uploading', () => {
    render(<PhotoUpload {...defaultProps} photoStatus="uploading" />);
    const input = screen.getByTestId('photo-file-input');
    expect(input).toBeDisabled();
  });

  it('disables file input after uploaded', () => {
    render(<PhotoUpload {...defaultProps} photoStatus="uploaded" />);
    const input = screen.getByTestId('photo-file-input');
    expect(input).toBeDisabled();
  });

  // ── Status indicators ────────────────────────────────────────────────────

  it('shows uploading indicator', () => {
    render(<PhotoUpload {...defaultProps} photoStatus="uploading" />);
    expect(screen.getByText('Uploading photo...')).toBeInTheDocument();
  });

  it('shows uploaded indicator', () => {
    render(<PhotoUpload {...defaultProps} photoStatus="uploaded" />);
    expect(screen.getByText('Photo uploaded')).toBeInTheDocument();
  });

  it('shows error message', () => {
    render(<PhotoUpload {...defaultProps} photoError="Upload failed." />);
    expect(screen.getByText('Upload failed.')).toBeInTheDocument();
  });

  // ── GPS acquisition ──────────────────────────────────────────────────────

  it('calls onGpsChange with complete sample on successful geolocation', async () => {
    const onGpsChange = vi.fn();
    const onFileChange = vi.fn();
    mockGeolocation(0, { latitude: 14.5, longitude: 121.0, accuracy: 10 });

    render(<PhotoUpload {...defaultProps} onFileChange={onFileChange} onGpsChange={onGpsChange} />);

    const input = screen.getByTestId('photo-file-input');
    const file = jpegFile();
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    // GPS callback should fire with complete sample
    await waitFor(() => {
      expect(onGpsChange).toHaveBeenCalledWith(
        expect.objectContaining({
          latitude: 14.5,
          longitude: 121.0,
          accuracy: 10,
          capturedAt: expect.any(String),
        }),
      );
    });
  });

  it('calls onGpsChange with null when geolocation is denied', async () => {
    const onGpsChange = vi.fn();
    const onFileChange = vi.fn();
    mockGeolocation(1); // PERMISSION_DENIED

    render(<PhotoUpload {...defaultProps} onFileChange={onFileChange} onGpsChange={onGpsChange} />);

    const input = screen.getByTestId('photo-file-input');
    const file = jpegFile();
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    await waitFor(() => {
      expect(onGpsChange).toHaveBeenCalledWith(null);
    });
  });

  it('calls onGpsChange with null when geolocation is unavailable', async () => {
    const onGpsChange = vi.fn();
    const onFileChange = vi.fn();
    removeGeolocation();

    render(<PhotoUpload {...defaultProps} onFileChange={onFileChange} onGpsChange={onGpsChange} />);

    const input = screen.getByTestId('photo-file-input');
    const file = jpegFile();
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    await waitFor(() => {
      expect(onGpsChange).toHaveBeenCalledWith(null);
    });
  });

  // ── Offline explanation mode ─────────────────────────────────────────────

  it('shows offline explanation when offlineExplanation is true and no file selected', () => {
    render(<PhotoUpload {...defaultProps} offlineExplanation={true} />);
    expect(screen.getByTestId('photo-upload-offline')).toBeInTheDocument();
    expect(screen.getByText(/Photos require an internet connection/)).toBeInTheDocument();
  });

  it('does not show offline explanation when a file is already selected', () => {
    render(
      <PhotoUpload
        {...defaultProps}
        file={jpegFile()}
        offlineExplanation={true}
      />,
    );
    expect(screen.queryByTestId('photo-upload-offline')).not.toBeInTheDocument();
    expect(screen.getByTestId('photo-upload')).toBeInTheDocument();
  });

  // ── Object URL lifecycle ─────────────────────────────────────────────────

  it('revokes object URL on unmount', async () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');

    const { unmount } = render(
      <PhotoUpload {...defaultProps} file={jpegFile()} />,
    );

    // Initial render creates an object URL
    expect(revokeSpy).not.toHaveBeenCalled();

    unmount();

    // On unmount, the object URL should be revoked
    expect(revokeSpy).toHaveBeenCalled();
  });

  it('revokes old object URL when file is replaced', async () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');

    const { rerender } = render(
      <PhotoUpload {...defaultProps} file={jpegFile()} />,
    );

    revokeSpy.mockClear();

    // Re-render with a new file
    rerender(<PhotoUpload {...defaultProps} file={pngFile()} />);

    expect(revokeSpy).toHaveBeenCalled();
  });
});
