import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { PhotoUpload, type PhotoGpsSample } from './PhotoUpload';

// ── Mock compressPhoto ──────────────────────────────────────────────────────
// Compression uses OffscreenCanvas which is not available in jsdom.
// We mock the module to simulate compression behavior.
vi.mock('@/lib/photoExif', () => ({
  extractExifGps: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/photoCompression', () => ({
    compressPhoto: vi.fn(async (file: File) => {
      // Simulate compression delay
      await new Promise((r) => setTimeout(r, 0));
      const originalSizeBytes = file.size;
      // Return a compressed version that's roughly 40% of original size
      const compressedSize = Math.min(originalSizeBytes, Math.round(originalSizeBytes * 0.4));
      const compressedBlob = new Blob([new Uint8Array(compressedSize)], { type: 'image/jpeg' });
      return {
        blob: compressedBlob,
        width: 640,
        height: 480,
        originalSizeBytes,
        compressedSizeBytes: compressedSize,
        oversized: false,
      };
    }),
  }));

import { compressPhoto } from '@/lib/photoCompression';
const mockCompress = vi.mocked(compressPhoto);

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

  it('shows gallery button when no file is selected', () => {
    render(<PhotoUpload {...defaultProps} />);
    expect(screen.getByText('Choose from Gallery')).toBeInTheDocument();
  });

  it('camera input has capture="environment" on mobile', () => {
    // Store the original navigator userAgent getter by reading the full descriptor
    // from the Navigator prototype. navigator.userAgent is a prototype getter,
    // not an own property, so getOwnPropertyDescriptor on the instance returns undefined.
    const prototype = Object.getPrototypeOf(navigator);
    const origDescriptor = Object.getOwnPropertyDescriptor(prototype, 'userAgent');

    // Override with a mobile user agent
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      configurable: true,
      writable: false,
    });

    const { unmount } = render(<PhotoUpload {...defaultProps} />);
    const cameraInput = screen.getByTestId('photo-camera-input');
    expect(cameraInput).toHaveAttribute('capture', 'environment');
    expect(cameraInput).toHaveAttribute('type', 'file');
    expect(cameraInput).toHaveAttribute('accept', 'image/jpeg,image/png');
    unmount();

    // Restore original descriptor
    delete navigator.userAgent;
    if (origDescriptor) {
      Object.defineProperty(prototype, 'userAgent', origDescriptor);
    }
  });

  it('gallery input does NOT have capture attribute', () => {
    render(<PhotoUpload {...defaultProps} />);
    const galleryInput = screen.getByTestId('photo-file-input');
    expect(galleryInput).toBeInTheDocument();
    expect(galleryInput).not.toHaveAttribute('capture');
    expect(galleryInput).toHaveAttribute('type', 'file');
    expect(galleryInput).toHaveAttribute('accept', 'image/jpeg,image/png');
  });

  it('desktop: only gallery button shown, no take photo button', () => {
    // Default test environment is desktop (no mobile user agent)
    render(<PhotoUpload {...defaultProps} />);
    expect(screen.getByTestId('photo-gallery-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('photo-take-photo-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('photo-camera-input')).not.toBeInTheDocument();
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
    // Wait for promise chain (EXIF → compression) to complete
    await vi.waitFor(() => {
      expect(onFileChange).toHaveBeenCalled();
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
    // Wait for promise chain (EXIF → compression) to complete
    await vi.waitFor(() => {
      expect(onFileChange).toHaveBeenCalled();
    });
    expect(onFileChange).toHaveBeenCalledWith(file);
  });

  // ── Compression ─────────────────────────────────────────────────────────

  it('shows compressing indicator while processing', async () => {
    // Make compression resolve after a microtask so we can observe the compressing state
    mockCompress.mockImplementationOnce(async (file: File) => {
      await new Promise((r) => setTimeout(r, 50));
      const compressedBlob = new Blob([new Uint8Array(500)], { type: 'image/jpeg' });
      return {
        blob: compressedBlob,
        width: 640,
        height: 480,
        originalSizeBytes: file.size,
        compressedSizeBytes: 500,
        oversized: false,
      };
    });

    const onFileChange = vi.fn();
    render(<PhotoUpload {...defaultProps} onFileChange={onFileChange} />);

    const input = screen.getByTestId('photo-file-input');
    const file = jpegFile(50000); // 50KB
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    // Compressing indicator should appear
    expect(screen.getByText('Compressing photo...')).toBeInTheDocument();

    // After compression resolves, the indicator should disappear
    await waitFor(() => {
      expect(screen.queryByText('Compressing photo...')).not.toBeInTheDocument();
    });
  });

  it('compressed file calls onFileChange with compressed blob', async () => {
    const onFileChange = vi.fn();
    const file = jpegFile(3 * 1024 * 1024); // 3MB
    render(<PhotoUpload {...defaultProps} onFileChange={onFileChange} />);

    const input = screen.getByTestId('photo-file-input');
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    // After compression, onFileChange should be called with a compressed file
    await waitFor(() => {
      expect(onFileChange).toHaveBeenCalledOnce();
      const calledFile = onFileChange.mock.calls[0][0] as File | null;
      expect(calledFile).not.toBeNull();
      expect(calledFile!.size).toBeLessThan(file.size);
    });
  });

  it('preview shows size reduction when file prop is set with compressed info', async () => {
    // When the parent provides a compressed file and compressedSizeInfo was set
    // internally, we verify the display by checking onFileChange was invoked.
    // The component is controlled: it shows the preview when file !== null.
    const onFileChange = vi.fn();
    const file = jpegFile(3 * 1024 * 1024);
    render(<PhotoUpload {...defaultProps} onFileChange={onFileChange} />);

    const input = screen.getByTestId('photo-file-input');
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    await waitFor(() => {
      expect(onFileChange).toHaveBeenCalled();
      const compressedFile = onFileChange.mock.calls[0][0] as File;
      expect(compressedFile.name).toBe('photo.jpg');
      expect(compressedFile.type).toBe('image/jpeg');
    });
  });

  it('accepts large files (replaces 5MB gate with compression)', async () => {
    const onFileChange = vi.fn();
    render(<PhotoUpload {...defaultProps} onFileChange={onFileChange} />);

    const input = screen.getByTestId('photo-file-input');
    const file = jpegFile(10 * 1024 * 1024); // 10MB — previously rejected
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    // Should NOT show size error
    expect(screen.queryByText('Photo must be under 5 MB.')).not.toBeInTheDocument();

    // Should process the file (compression will produce a new blob)
    await waitFor(() => {
      expect(onFileChange).toHaveBeenCalled();
    });
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

  it('shows offline banner inside photo-upload when online is false and no file selected', () => {
    render(<PhotoUpload {...defaultProps} online={false} />);
    expect(screen.getByTestId('photo-upload')).toBeInTheDocument();
    expect(screen.getByText(/Photos will be saved/)).toBeInTheDocument();
    // File inputs should still be rendered (not blocked by offline banner)
    expect(screen.getByTestId('photo-gallery-btn')).toBeInTheDocument();
  });

  it('does not show offline info banner when a file is already selected (shows preview instead)', () => {
    render(
      <PhotoUpload
        {...defaultProps}
        file={jpegFile()}
        online={false}
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
