export interface ProcessedMediaHandle {
  stream: MediaStream;
  dispose: () => void;
}

/**
 * Applies a lightweight WebAudio voice-band filter chain (85 Hz high-pass rumble removal,
 * 7.2 kHz low-pass hiss attenuation, and gentle speech dynamics compression) on top of
 * browser hardware AEC/NS/AGC. Does not stop `rawStream` tracks on dispose.
 */
export function createVoiceIsolationProcessor(rawStream: MediaStream): ProcessedMediaHandle {
  const AudioCtx =
    typeof window !== 'undefined'
      ? (window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
      : undefined;

  if (!AudioCtx || rawStream.getAudioTracks().length === 0) {
    return { stream: rawStream, dispose: () => {} };
  }

  try {
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }
    const source = ctx.createMediaStreamSource(rawStream);
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 85;
    highpass.Q.value = 0.707;

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 7200;
    lowpass.Q.value = 0.707;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 18;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.18;

    const destination = ctx.createMediaStreamDestination();
    source.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(compressor);
    compressor.connect(destination);

    let disposed = false;
    return {
      stream: destination.stream,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        try {
          source.disconnect();
          highpass.disconnect();
          lowpass.disconnect();
          compressor.disconnect();
        } catch {
          /* Ignore disconnect errors on already-closed graph. */
        }
        destination.stream.getTracks().forEach((track) => track.stop());
        void ctx.close().catch(() => {});
      },
    };
  } catch {
    return { stream: rawStream, dispose: () => {} };
  }
}

interface FaceDetectorLike {
  detect: (
    image: CanvasImageSource,
  ) => Promise<Array<{ boundingBox: { x: number; y: number; width: number; height: number } }>>;
}

/**
 * Enables background blur on a camera track: prefers native W3C `backgroundBlur` constraints
 * when the browser/OS driver supports it, otherwise applies a smooth Canvas portrait bokeh pass.
 * Caller retains ownership of `rawVideoTrack`.
 */
export async function createBackgroundBlurProcessor(
  rawVideoTrack: MediaStreamTrack,
  fps = 20,
): Promise<ProcessedMediaHandle> {
  const capabilities =
    typeof rawVideoTrack.getCapabilities === 'function'
      ? (rawVideoTrack.getCapabilities() as Record<string, unknown>)
      : null;

  if (capabilities && 'backgroundBlur' in capabilities) {
    try {
      await rawVideoTrack.applyConstraints({
        advanced: [{ backgroundBlur: true } as unknown as MediaTrackConstraintSet],
      });
      return {
        stream: new MediaStream([rawVideoTrack]),
        dispose: () => {
          void rawVideoTrack
            .applyConstraints({
              advanced: [{ backgroundBlur: false } as unknown as MediaTrackConstraintSet],
            })
            .catch(() => {});
        },
      };
    } catch {
      /* Fall back to canvas portrait blur if native constraint is rejected. */
    }
  }

  if (typeof document === 'undefined') {
    return { stream: new MediaStream([rawVideoTrack]), dispose: () => {} };
  }

  const settings = rawVideoTrack.getSettings();
  const srcW = settings.width && settings.width > 0 ? settings.width : 640;
  const srcH = settings.height && settings.height > 0 ? settings.height : 360;
  const scale = Math.min(1, 800 / srcW, 450 / srcH);
  const width = Math.max(160, Math.round(srcW * scale));
  const height = Math.max(90, Math.round(srcH * scale));

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([rawVideoTrack]);
  void video.play().catch(() => {});

  const mainCanvas = document.createElement('canvas');
  mainCanvas.width = width;
  mainCanvas.height = height;
  const mainCtx = mainCanvas.getContext('2d');

  const fgCanvas = document.createElement('canvas');
  fgCanvas.width = width;
  fgCanvas.height = height;
  const fgCtx = fgCanvas.getContext('2d');

  if (!mainCtx || !fgCtx || typeof mainCanvas.captureStream !== 'function') {
    video.srcObject = null;
    return { stream: new MediaStream([rawVideoTrack]), dispose: () => {} };
  }

  const FaceDetectorCtor = (
    globalThis as unknown as { FaceDetector?: new (opts?: { fastMode?: boolean; maxDetectedFaces?: number }) => FaceDetectorLike }
  ).FaceDetector;
  const faceDetector = FaceDetectorCtor ? new FaceDetectorCtor({ fastMode: true, maxDetectedFaces: 1 }) : null;

  let focusX = 0.5;
  let focusY = 0.45;
  let lastDetectAt = 0;
  let detecting = false;
  let disposed = false;

  const renderFrame = () => {
    if (disposed || video.readyState < 2) return;

    // Update portrait center occasionally when Chromium FaceDetector is available.
    const now = performance.now();
    if (faceDetector && !detecting && now - lastDetectAt > 300) {
      detecting = true;
      lastDetectAt = now;
      void faceDetector
        .detect(video)
        .then((faces) => {
          if (disposed || faces.length === 0) return;
          const box = faces[0].boundingBox;
          const targetX = Math.max(0.2, Math.min(0.8, (box.x + box.width / 2) / (video.videoWidth || width)));
          const targetY = Math.max(0.2, Math.min(0.75, (box.y + box.height * 0.65) / (video.videoHeight || height)));
          focusX = focusX * 0.75 + targetX * 0.25;
          focusY = focusY * 0.75 + targetY * 0.25;
        })
        .catch(() => {})
        .finally(() => {
          detecting = false;
        });
    }

    // 1) Draw blurred background
    mainCtx.save();
    mainCtx.clearRect(0, 0, width, height);
    mainCtx.filter = 'blur(14px)';
    mainCtx.drawImage(video, 0, 0, width, height);
    mainCtx.restore();

    // 2) Draw sharp subject masked by a soft portrait radial gradient
    fgCtx.save();
    fgCtx.globalCompositeOperation = 'source-over';
    fgCtx.clearRect(0, 0, width, height);
    fgCtx.drawImage(video, 0, 0, width, height);

    const cx = focusX * width;
    const cy = focusY * height;
    const minDim = Math.min(width, height);
    const innerR = minDim * 0.24;
    const outerR = minDim * 0.58;
    const grad = fgCtx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(0.65, 'rgba(0,0,0,0.85)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');

    fgCtx.globalCompositeOperation = 'destination-in';
    fgCtx.fillStyle = grad;
    fgCtx.fillRect(0, 0, width, height);
    fgCtx.restore();

    // 3) Composite sharp foreground over blurred backdrop
    mainCtx.drawImage(fgCanvas, 0, 0, width, height);
  };

  const intervalId = window.setInterval(renderFrame, Math.max(33, Math.round(1000 / fps)));
  const outputStream = mainCanvas.captureStream(fps);

  return {
    stream: outputStream,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      window.clearInterval(intervalId);
      outputStream.getTracks().forEach((track) => track.stop());
      video.pause();
      video.srcObject = null;
    },
  };
}
