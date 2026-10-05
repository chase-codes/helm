import type { VideoError } from '../types';

/** The operator-facing explanation of a failed video: one fixed title, one short reason. */
export interface VideoErrorText { title: string; reason: string }

export const VIDEO_ERROR_TITLE = "Can't play this video";

const REEXPORT = 'Re-export it as an H.264 MP4 and import it again.';

// MediaError.code: 1 aborted, 2 network, 3 decode, 4 src not supported. A play() rejection
// carries a DOMException name instead. Unsupported format/codec is by far the likeliest
// (HEVC, ProRes, an odd container), so it gets the concrete next step.
export function videoErrorText(e: VideoError): VideoErrorText {
  let reason: string;
  if (e.code === 4 || e.name === 'NotSupportedError') {
    reason = `This computer can't play this file's format or codec. ${REEXPORT}`;
  } else if (e.code === 3) {
    reason = `The video couldn't be decoded — the file may be damaged or use an unsupported codec. ${REEXPORT}`;
  } else if (e.code === 2) {
    reason = "The video file couldn't be read. Check that it is still in the library, or import it again.";
  } else if (e.name === 'NotAllowedError') {
    reason = 'Playback was blocked by the system before it could start.';
  } else {
    reason = 'Playback failed to start.';
  }
  return { title: VIDEO_ERROR_TITLE, reason };
}
