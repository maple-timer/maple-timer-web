import {
  AlertTriangle,
  Edit3,
  HardDrive,
  Music2,
  Play,
  Save,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createCustomAlertSoundId,
  decodeAudioBlob,
  deleteCustomAlertSound,
  getCustomAlertSoundRecord,
  saveCustomAlertSound,
  updateCustomAlertSound,
  validateCustomSoundFile,
  type CustomAlertSoundMetadata,
} from "../../lib/customSounds";
import { trackCustomSoundSaved } from "../../lib/analyticsEvents";
import { playAudioSourceSegment } from "../../lib/audioPlayback";
import { FloatingTooltipButton } from "../../shared/components/FloatingTooltip";
import { MotionDialogFrame } from "../../shared/components/MotionDialogFrame";
import {
  formatCustomSoundDurationMs,
  formatCustomSoundFileSize,
  getCustomSoundTrimFromRatio,
  getCustomSoundWaveformViewModel,
} from "./customSoundDialogViewModel";
import {
  buildCustomSoundDraft,
  buildCustomSoundSaveInput,
  buildCustomSoundUpdatePatch,
  getCustomSoundDeleteSuccessMessage,
  type DraftSound,
  type DragHandle,
  type PreviewPlaybackState,
} from "./customSoundDialogControllerModel";

export function CustomSoundManagerDialog({
  customSounds,
  onClose,
  onChanged,
  onSoundDeleted,
  onMessage,
}: {
  customSounds: CustomAlertSoundMetadata[];
  onClose: () => void;
  onChanged: () => Promise<void>;
  onSoundDeleted: (soundId: string) => number;
  onMessage: (message: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const waveformRef = useRef<HTMLDivElement>(null);
  const previewFrameRef = useRef<number | null>(null);
  const previewTokenRef = useRef(0);
  const previewAbortRef = useRef<AbortController | null>(null);
  const [draft, setDraft] = useState<DraftSound | null>(null);
  const [dragHandle, setDragHandle] = useState<DragHandle | null>(null);
  const [previewPlayback, setPreviewPlayback] = useState<PreviewPlaybackState | null>(null);
  const [activeSavedPreviewId, setActiveSavedPreviewId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomAlertSoundMetadata | null>(null);
  const [isBusy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const clearPreviewProgress = useCallback((token?: number) => {
    if (token !== undefined && previewTokenRef.current !== token) {
      return;
    }
    previewTokenRef.current += 1;
    if (previewFrameRef.current !== null) {
      cancelAnimationFrame(previewFrameRef.current);
      previewFrameRef.current = null;
    }
    setPreviewPlayback((current) => {
      if (token !== undefined && current?.token !== token) {
        return current;
      }
      return null;
    });
  }, []);

  const stopPreviewPlayback = useCallback(() => {
    previewAbortRef.current?.abort();
    previewAbortRef.current = null;
    clearPreviewProgress();
    setActiveSavedPreviewId(null);
  }, [clearPreviewProgress]);

  const startPreviewProgress = useCallback(
    (trimStartMs: number, trimEndMs: number) => {
      clearPreviewProgress();
      const token = previewTokenRef.current + 1;
      previewTokenRef.current = token;
      const startedAt = performance.now();

      setPreviewPlayback({
        token,
        trimStartMs,
        trimEndMs,
        progressMs: trimStartMs,
      });

      const step = () => {
        if (previewTokenRef.current !== token) {
          return;
        }
        const elapsedMs = performance.now() - startedAt;
        const progressMs = Math.min(trimEndMs, trimStartMs + elapsedMs);
        setPreviewPlayback((current) => {
          if (!current || current.token !== token) {
            return current;
          }
          return {
            ...current,
            progressMs,
          };
        });
        previewFrameRef.current =
          progressMs < trimEndMs ? requestAnimationFrame(step) : null;
      };
      previewFrameRef.current = requestAnimationFrame(step);
      return token;
    },
    [clearPreviewProgress],
  );

  const updateTrimFromClientX = useCallback((handle: DragHandle, clientX: number) => {
    const rect = waveformRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) {
      return;
    }
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));

    setDraft((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        ...getCustomSoundTrimFromRatio({ current, handle, ratio }),
      };
    });
  }, []);

  useEffect(() => {
    if (!dragHandle) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      updateTrimFromClientX(dragHandle, event.clientX);
    };
    const handlePointerUp = () => setDragHandle(null);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragHandle, updateTrimFromClientX]);

  useEffect(
    () => () => {
      stopPreviewPlayback();
    },
    [stopPreviewPlayback],
  );

  const prepareDraft = useCallback(
    async ({
      blob,
      fileName,
      name,
      metadata,
      mode,
    }: {
      blob: Blob;
      fileName?: string;
      name?: string;
      metadata?: CustomAlertSoundMetadata;
      mode: DraftSound["mode"];
    }) => {
      setBusy(true);
      setStatus("알림음 파일을 분석하고 있습니다.");
      try {
        const audioBuffer = await decodeAudioBlob(blob);
        const result = buildCustomSoundDraft({
          audioBuffer,
          blob,
          fileName,
          name,
          metadata,
          mode,
        });
        if (!result.ok) {
          setStatus(result.status);
          return;
        }

        setDraft(result.draft);
        setStatus(null);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "알림음 파일을 분석하지 못했습니다.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const handleFileSelected = useCallback(
    (file: File | undefined) => {
      if (!file) {
        return;
      }

      const validationMessage = validateCustomSoundFile(file);
      if (validationMessage) {
        setStatus(validationMessage);
        return;
      }

      void prepareDraft({
        blob: file,
        fileName: file.name,
        name: file.name.replace(/\.[^/.]+$/, ""),
        mode: "new",
      });
    },
    [prepareDraft],
  );

  const handleEdit = useCallback(
    async (sound: CustomAlertSoundMetadata) => {
      setBusy(true);
      setStatus("저장된 알림음을 불러오고 있습니다.");
      try {
        const record = await getCustomAlertSoundRecord(sound.id);
        if (!record) {
          setStatus("수정할 사용자 알림음을 찾지 못했습니다.");
          return;
        }
        await prepareDraft({
          blob: record.blob,
          name: record.name,
          metadata: sound,
          mode: "edit",
        });
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "사용자 알림음을 불러오지 못했습니다.");
      } finally {
        setBusy(false);
      }
    },
    [prepareDraft],
  );

  const handlePreviewSavedSound = useCallback(
    async (sound: CustomAlertSoundMetadata) => {
      if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
        setStatus("이 브라우저는 알림음 미리듣기를 지원하지 않습니다.");
        return;
      }

      if (activeSavedPreviewId === sound.id) {
        stopPreviewPlayback();
        return;
      }

      stopPreviewPlayback();
      const previewController = new AbortController();
      previewAbortRef.current = previewController;
      setActiveSavedPreviewId(sound.id);
      let releaseSavedSource: (() => void) | null = null;
      try {
        const record = await getCustomAlertSoundRecord(sound.id);
        if (previewController.signal.aborted) {
          return;
        }
        if (!record) {
          setStatus("재생할 사용자 알림음을 찾지 못했습니다.");
          if (previewAbortRef.current === previewController) {
            previewAbortRef.current = null;
          }
          setActiveSavedPreviewId(null);
          return;
        }

        const source = URL.createObjectURL(record.blob);
        let isSourceReleased = false;
        const releaseSource = () => {
          if (!isSourceReleased) {
            URL.revokeObjectURL(source);
            isSourceReleased = true;
          }
          if (previewAbortRef.current === previewController) {
            previewAbortRef.current = null;
          }
          setActiveSavedPreviewId((current) => (current === sound.id ? null : current));
        };
        releaseSavedSource = releaseSource;
        await playAudioSourceSegment(source, 1, {
          startTimeSeconds: record.trimStartMs / 1000,
          endTimeSeconds: record.trimEndMs / 1000,
          signal: previewController.signal,
          onRelease: releaseSource,
        });
      } catch (error) {
        if (previewAbortRef.current === previewController) {
          previewAbortRef.current = null;
        }
        releaseSavedSource?.();
        setActiveSavedPreviewId((current) => (current === sound.id ? null : current));
        if (!previewController.signal.aborted) {
          setStatus(error instanceof Error ? error.message : "알림음 미리듣기에 실패했습니다.");
        }
      }
    },
    [activeSavedPreviewId, stopPreviewPlayback],
  );

  const handlePreviewDraft = useCallback(async () => {
    if (!draft || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
      return;
    }

    stopPreviewPlayback();
    const previewController = new AbortController();
    previewAbortRef.current = previewController;
    const source = URL.createObjectURL(draft.blob);
    let isSourceReleased = false;
    const previewToken = startPreviewProgress(draft.trimStartMs, draft.trimEndMs);
    const releaseSource = () => {
      if (!isSourceReleased) {
        URL.revokeObjectURL(source);
        isSourceReleased = true;
      }
      if (previewAbortRef.current === previewController) {
        previewAbortRef.current = null;
      }
      clearPreviewProgress(previewToken);
    };
    try {
      await playAudioSourceSegment(source, 1, {
        startTimeSeconds: draft.trimStartMs / 1000,
        endTimeSeconds: draft.trimEndMs / 1000,
        signal: previewController.signal,
        onRelease: releaseSource,
      });
    } catch (error) {
      if (previewAbortRef.current === previewController) {
        previewAbortRef.current = null;
      }
      if (!isSourceReleased) {
        URL.revokeObjectURL(source);
        isSourceReleased = true;
      }
      clearPreviewProgress(previewToken);
      if (!previewController.signal.aborted) {
        setStatus(error instanceof Error ? error.message : "알림음 미리듣기에 실패했습니다.");
      }
    }
  }, [clearPreviewProgress, draft, startPreviewProgress, stopPreviewPlayback]);

  const handleSaveDraft = useCallback(async () => {
    if (!draft) {
      return;
    }

    stopPreviewPlayback();
    setBusy(true);
    try {
      if (draft.mode === "new") {
        await saveCustomAlertSound(buildCustomSoundSaveInput(draft));
        trackCustomSoundSaved("create");
        onMessage("사용자 알림음을 추가했습니다.");
      } else if (draft.id) {
        await updateCustomAlertSound(draft.id, buildCustomSoundUpdatePatch(draft));
        trackCustomSoundSaved("update");
        onMessage("사용자 알림음을 수정했습니다.");
      }
      setDraft(null);
      setStatus(null);
      await onChanged();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "사용자 알림음을 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }, [draft, onChanged, onMessage, stopPreviewPlayback]);

  const confirmDeleteTarget = useCallback(
    async () => {
      if (!deleteTarget) {
        return;
      }
      setBusy(true);
      try {
        await deleteCustomAlertSound(deleteTarget.id);
        const replacedCount = onSoundDeleted(createCustomAlertSoundId(deleteTarget.id));
        if (draft?.id === deleteTarget.id) {
          setDraft(null);
        }
        setDeleteTarget(null);
        await onChanged();
        onMessage(getCustomSoundDeleteSuccessMessage(replacedCount));
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "사용자 알림음을 삭제하지 못했습니다.");
      } finally {
        setBusy(false);
      }
    },
    [deleteTarget, draft?.id, onChanged, onMessage, onSoundDeleted],
  );

  const waveformViewModel = getCustomSoundWaveformViewModel(draft, previewPlayback);

  return (
    <MotionDialogFrame
      backdropClassName="custom-sound-backdrop"
      dialogClassName="custom-sound-dialog"
      labelledBy="custom-sound-title"
      onBackdropMouseDown={onClose}
      onDialogMouseDown={(event) => event.stopPropagation()}
    >
        <header className="custom-sound-dialog-header">
          <div>
            <p className="eyebrow">Custom Sounds</p>
            <h2 id="custom-sound-title">내 알림음</h2>
            <p>알림음 파일을 이 브라우저에 저장하고 필요한 구간만 잘라 사용합니다.</p>
          </div>
          <button className="icon-button small" type="button" aria-label="닫기" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="custom-sound-policy-grid" role="note">
          <div className="custom-sound-policy-card">
            <HardDrive size={17} aria-hidden="true" />
            <div>
              <strong>브라우저에만 저장</strong>
              <span>파일은 서버로 전송되지 않고 현재 브라우저에만 저장됩니다.</span>
            </div>
          </div>
          <div className="custom-sound-policy-card warning">
            <AlertTriangle size={17} aria-hidden="true" />
            <div>
              <strong>사용자 책임</strong>
              <span>파일의 저작권, 내용, 음량, 사용으로 인한 문제는 사용자 본인에게 책임이 있습니다.</span>
            </div>
          </div>
        </div>

        <div className="custom-sound-workspace">
          <section className="custom-sound-workbench" aria-label="사용자 알림음 만들기">
            <div className="custom-sound-section-heading">
              <div>
                <h3>알림음 만들기</h3>
                <span>파일을 올리고 필요한 구간만 잘라 저장합니다.</span>
              </div>
            </div>

            <button
              className="custom-sound-upload-dropzone"
              type="button"
              disabled={isBusy}
              onClick={() => fileInputRef.current?.click()}
            >
              <span className="custom-sound-upload-icon">
                <Upload size={18} aria-hidden="true" />
              </span>
              <span>
                <strong>알림음 업로드</strong>
                <small>mp3, m4a, wav, ogg / 5MB 이하 / 사용 구간 최대 15초</small>
              </span>
            </button>
            <input
              ref={fileInputRef}
              className="custom-sound-file-input"
              type="file"
              accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/ogg,.mp3,.m4a,.mp4,.wav,.ogg"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = "";
                handleFileSelected(file);
              }}
            />

            {status && <p className="custom-sound-status">{status}</p>}

            {draft ? (
              <section className="custom-sound-editor" aria-label="알림음 편집">
                <div className="custom-sound-editor-toolbar">
                  <label className="field-label custom-sound-name-field">
                    이름
                    <input
                      type="text"
                      value={draft.name}
                      maxLength={60}
                      onChange={(event) =>
                        setDraft((current) =>
                          current ? { ...current, name: event.target.value.slice(0, 60) } : current,
                        )
                      }
                    />
                  </label>
                  <div className="custom-sound-editor-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={Boolean(previewPlayback)}
                      onClick={() => void handlePreviewDraft()}
                    >
                      <Play size={16} />
                      미리듣기
                    </button>
                    <button
                      className="primary-button"
                      type="button"
                      disabled={isBusy || draft.name.trim().length === 0}
                      onClick={() => void handleSaveDraft()}
                    >
                      <Save size={16} />
                      {draft.mode === "new" ? "추가" : "저장"}
                    </button>
                  </div>
                </div>

                <div
                  className="custom-sound-waveform"
                  ref={waveformRef}
                  aria-label="알림음 구간 선택"
                  onPointerDown={(event) => {
                    if (!draft) {
                      return;
                    }
                    const rect = waveformRef.current?.getBoundingClientRect();
                    if (!rect) {
                      return;
                    }
                    const targetMs = Math.round(
                      draft.durationMs * Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
                    );
                    const startDistance = Math.abs(targetMs - draft.trimStartMs);
                    const endDistance = Math.abs(targetMs - draft.trimEndMs);
                    const handle = startDistance <= endDistance ? "start" : "end";
                    setDragHandle(handle);
                    updateTrimFromClientX(handle, event.clientX);
                  }}
                >
                  <div className="custom-sound-waveform-bars" aria-hidden="true">
                    {draft.peaks.map((peak, index) => (
                      <span
                        key={`${index}-${peak.toFixed(3)}`}
                        style={{ transform: `scaleY(${peak})` }}
                      />
                    ))}
                  </div>
                  <div
                    className="custom-sound-waveform-selection"
                    style={waveformViewModel.selectionStyle}
                  />
                  {waveformViewModel.previewStyle && (
                    <div
                      className="custom-sound-waveform-playhead"
                      aria-hidden="true"
                      style={waveformViewModel.previewStyle}
                    />
                  )}
                  <button
                    className="custom-sound-trim-handle start"
                    type="button"
                    aria-label="시작 지점 조절"
                    style={waveformViewModel.startHandleStyle}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      setDragHandle("start");
                    }}
                  />
                  <button
                    className="custom-sound-trim-handle end"
                    type="button"
                    aria-label="끝 지점 조절"
                    style={waveformViewModel.endHandleStyle}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      setDragHandle("end");
                    }}
                  />
                </div>

                <div className="custom-sound-editor-meta">
                  <span>전체 {formatCustomSoundDurationMs(draft.durationMs)}</span>
                  <strong>
                    선택 {formatCustomSoundDurationMs(draft.trimEndMs - draft.trimStartMs)} (
                    {formatCustomSoundDurationMs(draft.trimStartMs)} - {formatCustomSoundDurationMs(draft.trimEndMs)})
                  </strong>
                </div>
              </section>
            ) : (
              <div className="custom-sound-editor-empty">
                <Music2 size={19} aria-hidden="true" />
                <span>파일을 업로드하면 파형을 보면서 사용할 구간을 정할 수 있습니다.</span>
              </div>
            )}
          </section>

          <section className="custom-sound-list" aria-label="저장된 사용자 알림음">
            <div className="custom-sound-section-heading">
              <div>
                <h3>저장된 알림음</h3>
                <span>{customSounds.length}개 저장됨</span>
              </div>
            </div>
            {customSounds.length === 0 ? (
              <p className="custom-sound-empty">아직 저장한 사용자 알림음이 없습니다.</p>
            ) : (
              <div className="custom-sound-items">
                {customSounds.map((sound) => (
                  <article className="custom-sound-item" key={sound.id}>
                    <div>
                      <strong>{sound.name}</strong>
                      <span>
                        {formatCustomSoundDurationMs(sound.trimEndMs - sound.trimStartMs)} 사용 /{" "}
                        {formatCustomSoundFileSize(sound.size)}
                      </span>
                    </div>
                    <div className="custom-sound-item-actions">
                      <FloatingTooltipButton
                        className="icon-button small"
                        type="button"
                        tooltipId={`custom-sound-preview-${sound.id}`}
                        tooltip={activeSavedPreviewId === sound.id ? "중지" : "재생"}
                        aria-label={
                          activeSavedPreviewId === sound.id
                            ? `${sound.name} 재생 중지`
                            : `${sound.name} 재생`
                        }
                        disabled={isBusy}
                        onClick={() => void handlePreviewSavedSound(sound)}
                      >
                        {activeSavedPreviewId === sound.id ? <Square size={15} /> : <Play size={15} />}
                      </FloatingTooltipButton>
                      <FloatingTooltipButton
                        aria-label={`${sound.name} 편집`}
                        className="icon-button small"
                        type="button"
                        tooltipId={`custom-sound-edit-${sound.id}`}
                        tooltip="편집"
                        disabled={isBusy}
                        onClick={() => void handleEdit(sound)}
                      >
                        <Edit3 size={15} />
                      </FloatingTooltipButton>
                      <FloatingTooltipButton
                        aria-label={`${sound.name} 삭제`}
                        className="icon-button small"
                        type="button"
                        tooltipId={`custom-sound-delete-${sound.id}`}
                        tooltip="삭제"
                        disabled={isBusy}
                        onClick={() => setDeleteTarget(sound)}
                      >
                        <Trash2 size={15} />
                      </FloatingTooltipButton>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      <AnimatePresence>
      {deleteTarget && (
        <MotionDialogFrame
          backdropClassName="custom-sound-confirm-backdrop"
          dialogClassName="confirm-dialog custom-sound-delete-dialog"
          labelledBy="custom-sound-delete-title"
          onBackdropMouseDown={() => {
            if (!isBusy) {
              setDeleteTarget(null);
            }
          }}
          onDialogMouseDown={(event) => event.stopPropagation()}
        >
            <div>
              <p className="eyebrow">Delete Sound</p>
              <h2 id="custom-sound-delete-title">사용자 알림음 삭제</h2>
              <p>
                "{deleteTarget.name}" 파일을 이 브라우저에서 삭제합니다. 현재 설정에서 이
                알림음을 사용 중이면 기본 알림음으로 변경됩니다. 저장된 프리셋은 수정하지
                않으며, 나중에 적용할 때 없는 사용자 알림음은 기본 알림음으로 바뀝니다.
              </p>
            </div>
            <div className="confirm-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={isBusy}
                onClick={() => setDeleteTarget(null)}
              >
                유지
              </button>
              <button
                className="danger-button"
                type="button"
                disabled={isBusy}
                onClick={() => void confirmDeleteTarget()}
              >
                삭제
              </button>
            </div>
        </MotionDialogFrame>
      )}
      </AnimatePresence>
    </MotionDialogFrame>
  );
}
