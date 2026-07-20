import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EvidenceGallery } from '../EvidenceGallery';
import type { WorkspacePhoto } from '@/types/triage-workspace';

function photo(id: string): WorkspacePhoto {
  return {
    photo_id: id,
    content_url: `/api/triage/reports/7/photos/${id}/content`,
    media_type: 'image/jpeg',
    image_width: 800,
    image_height: 600,
    capture_time: null,
    exif_available: false,
    gps_consensus: null,
    evidence_source: 'pixel_sanitized',
    image_to_report_distance_m: null,
    device_to_exif_distance_m: null,
    exif_location: { source: 'image_exif_gps', available: false, latitude: null, longitude: null, accuracy_m: null, approximate: false, distance_to_report_m: null },
  };
}

describe('EvidenceGallery', () => {
  it('renders empty state', () => {
    render(<EvidenceGallery reportId={7} photos={[]} />);
    expect(screen.getByText('No image evidence submitted.')).toBeInTheDocument();
  });

  it('uses only exact sanitized content URLs and keeps partial failures visible', () => {
    render(<EvidenceGallery reportId={7} photos={[photo('one'), photo('two')]} />);
    const images = screen.getAllByRole('img');
    expect(images[0]).toHaveAttribute('src', '/api/triage/reports/7/photos/one/content');
    fireEvent.load(images[0]);
    fireEvent.error(images[1]);
    expect(screen.getByText('1 loaded, 1 unavailable')).toBeInTheDocument();
    expect(screen.getByText(/Remaining evidence is still usable/)).toBeInTheDocument();
  });

  it('rejects a non-canonical or cross-report content URL', () => {
    const unsafe = { ...photo('one'), content_url: '/api/triage/reports/8/photos/one/content' };
    render(<EvidenceGallery reportId={7} photos={[unsafe]} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText(/Sanitized image unavailable/)).toBeInTheDocument();
  });
});
