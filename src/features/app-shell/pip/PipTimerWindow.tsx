import { Slider } from "@astryxdesign/core/Slider";
import { Bell, BellOff, Volume2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type {
  PipHuntStallInfo,
  PipTimerDisplay,
  PipTimerItem,
  PipTimerItemKind,
} from "../../../application/pip/pipTimerPresentation";
import {
  getLikelyGameViewportCrop,
  type CaptureSize,
  type GameViewportCrop,
} from "../../../lib/gameResolutions";
import {
  DEFAULT_PIP_TIMER_CONFIG,
  getPipTimerAlertColorTheme,
} from "../../../lib/pipTimerSettings";
import { clampMasterVolume, getMasterVolumePercentLabel } from "../../../lib/volume";
import type { PipTimerConfig, PipTimerVisibleItems } from "../../../types";

const PIP_VISIBLE_ITEM_KEY_BY_KIND: Record<PipTimerItemKind, keyof PipTimerVisibleItems> = {
  skill: "skills",
  rune: "rune",
  "general-timer": "generalTimers",
  "buff-expiry": "buffExpiry",
  "hunt-stall": "experience",
  "special-core": "skills",
};

function formatTimerSeconds(seconds: number | null): string {
  if (seconds === null) {
    return "--";
  }

  if (seconds <= 0) {
    return "지금";
  }

  if (seconds < 60) {
    return String(seconds);
  }

  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function getTimerUnit(seconds: number | null): string {
  if (seconds === null || seconds <= 0) {
    return "";
  }
  return seconds < 60 ? "초" : "";
}

function getPipStyles(fontUrl: string): string {
  return `
    @font-face {
      font-family: "Pretendard Variable";
      font-style: normal;
      font-weight: 45 920;
      font-display: swap;
      src: url("${fontUrl}") format("woff2");
    }

    * {
      box-sizing: border-box;
    }

    :root {
      color-scheme: dark;
      scrollbar-gutter: auto;
      overflow: hidden;
      background: #08110d;
    }

    body {
      margin: 0;
      min-width: 260px;
      min-height: 180px;
      overflow: hidden;
      color: #f4faf6;
      background: #08110d;
      font-family:
        "Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Malgun Gothic",
        "맑은 고딕", "Noto Sans KR", ui-sans-serif, system-ui, sans-serif;
      font-synthesis: none;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }

    button {
      font: inherit;
    }

    .pip-window {
      --pip-alert-color: #ffd279;
      --pip-alert-rgb: 255 210 121;
      --pip-alert-surface: #21180d;
      --pip-alert-surface-strong: #36220b;
      --pip-alert-text: #1c1407;
      --pip-experience-accent: #b998ff;
      --pip-experience-rgb: 185 152 255;
      color-scheme: dark;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      width: 100vw;
      height: 100vh;
      padding: clamp(8px, 4.8vh, 14px);
      background: linear-gradient(160deg, #0b1511 0%, #111b17 54%, #0b0f0d 100%);
    }

    .pip-window.with-screen-preview {
      position: relative;
      isolation: isolate;
      overflow: hidden;
    }

    .pip-window.with-screen-preview::before {
      content: "";
      position: absolute;
      inset: 0;
      z-index: 1;
      pointer-events: none;
      background: transparent;
      box-shadow: inset 0 0 0 0 rgb(var(--pip-alert-rgb) / 0);
      opacity: 0;
    }

    .pip-window.urgent {
      animation: pip-urgent-pulse 1s ease-in-out infinite;
    }

    .pip-window.with-screen-preview.urgent::before {
      animation: pip-screen-urgent-pulse 1s ease-in-out infinite;
    }

    .pip-window.emphasis-soft.urgent {
      animation: none;
      box-shadow: inset 0 0 0 4px rgb(var(--pip-alert-rgb) / 0.22);
    }

    .pip-window.with-screen-preview.emphasis-soft.urgent::before {
      animation: none;
      box-shadow: inset 0 0 0 4px rgb(var(--pip-alert-rgb) / 0.38);
      opacity: 1;
    }

    .pip-window.emphasis-strong.urgent {
      animation-duration: 0.78s;
    }

    .pip-window.with-screen-preview.emphasis-strong.urgent::before {
      animation-duration: 0.78s;
    }

    .pip-window.emphasis-flash.urgent {
      animation-name: pip-urgent-flash;
      animation-duration: 0.72s;
      animation-timing-function: steps(2, jump-none);
    }

    .pip-window.with-screen-preview.emphasis-flash.urgent::before {
      animation-name: pip-screen-urgent-flash;
      animation-duration: 0.72s;
      animation-timing-function: steps(2, jump-none);
    }

    .pip-window.critical {
      animation-duration: 0.6s;
    }

    .pip-window.with-screen-preview.critical::before {
      animation-duration: 0.6s;
    }

    .pip-window.emphasis-flash.critical {
      animation-duration: 0.46s;
    }

    .pip-window.with-screen-preview.emphasis-flash.critical::before {
      animation-duration: 0.46s;
    }

    .pip-window.emphasis-flash.urgent .pip-time,
    .pip-window.emphasis-flash.urgent .pip-unit,
    .pip-window.emphasis-flash.urgent .pip-status,
    .pip-window.emphasis-flash.urgent.alert-style-preview .pip-empty {
      animation: pip-urgent-text-flash 0.72s steps(2, jump-none) infinite;
    }

    .pip-window.emphasis-flash.critical .pip-time,
    .pip-window.emphasis-flash.critical .pip-unit,
    .pip-window.emphasis-flash.critical .pip-status {
      animation-duration: 0.46s;
    }

    .pip-window.urgent.alert-settled,
    .pip-window.emphasis-strong.urgent.alert-settled,
    .pip-window.emphasis-flash.urgent.alert-settled,
    .pip-window.critical.alert-settled,
    .pip-window.emphasis-flash.critical.alert-settled {
      animation: none;
      box-shadow: inset 0 0 0 4px rgb(var(--pip-alert-rgb) / 0.22);
    }

    .pip-window.with-screen-preview.urgent.alert-settled::before,
    .pip-window.with-screen-preview.emphasis-flash.urgent.alert-settled::before,
    .pip-window.with-screen-preview.critical.alert-settled::before {
      animation: none;
      box-shadow: inset 0 0 0 4px rgb(var(--pip-alert-rgb) / 0.38);
      opacity: 1;
    }

    .pip-window.urgent.alert-settled .pip-time,
    .pip-window.urgent.alert-settled .pip-unit,
    .pip-window.urgent.alert-settled .pip-status,
    .pip-window.emphasis-flash.urgent.alert-settled .pip-time,
    .pip-window.emphasis-flash.urgent.alert-settled .pip-unit,
    .pip-window.emphasis-flash.urgent.alert-settled .pip-status,
    .pip-window.emphasis-flash.critical.alert-settled .pip-time,
    .pip-window.emphasis-flash.critical.alert-settled .pip-unit,
    .pip-window.emphasis-flash.critical.alert-settled .pip-status {
      animation: none;
      color: var(--pip-alert-color);
    }

    .pip-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-width: 0;
    }

    .pip-title {
      min-width: 0;
      color: #83dcae;
      font-size: 0.72rem;
      font-weight: 880;
      letter-spacing: 0;
      text-transform: uppercase;
    }

    .pip-header-actions {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .pip-alert-toggle,
    .pip-close-button {
      display: inline-grid;
      place-items: center;
      width: 28px;
      height: 28px;
      padding: 0;
      border: 1px solid rgba(143, 176, 159, 0.25);
      border-radius: 8px;
      color: #dcebe3;
      background: rgba(255, 255, 255, 0.06);
      cursor: pointer;
    }

    .pip-alert-toggle:hover,
    .pip-close-button:hover {
      border-color: rgba(143, 220, 174, 0.48);
      background: rgba(255, 255, 255, 0.1);
    }

    .pip-alert-toggle:focus-visible,
    .pip-close-button:focus-visible {
      outline: 2px solid #83dcae;
      outline-offset: 2px;
    }

    .pip-alert-toggle.is-active {
      border-color: rgba(255, 255, 255, 0.28);
      color: #ffffff;
      background: rgba(255, 255, 255, 0.14);
    }

    .pip-alert-toggle:disabled {
      cursor: not-allowed;
      opacity: 0.38;
    }

    .pip-main {
      display: grid;
      align-content: center;
      justify-items: center;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      padding: 8px 0 4px;
      text-align: center;
    }

    .pip-window.with-screen-preview .pip-header,
    .pip-window.with-screen-preview .pip-main,
    .pip-window.with-screen-preview .pip-experience,
    .pip-window.with-screen-preview .pip-controls {
      position: relative;
      z-index: 2;
    }

    .pip-main-label {
      max-width: 100%;
      color: #d9e7df;
      font-size: clamp(0.68rem, 4.4vw, 0.92rem);
      font-weight: 840;
      line-height: 1.18;
      overflow-wrap: anywhere;
      word-break: keep-all;
    }

    .pip-time-row {
      display: flex;
      align-items: baseline;
      justify-content: center;
      gap: 7px;
      margin-top: 4px;
    }

    .pip-time {
      color: #ffffff;
      font-size: clamp(2.55rem, 24vw, 5.9rem);
      font-weight: 880;
      line-height: 0.95;
      letter-spacing: 0;
      font-variant-numeric: tabular-nums;
      text-shadow: 0 12px 30px rgba(0, 0, 0, 0.36);
    }

    .pip-unit {
      color: #aac8b8;
      font-size: clamp(1.05rem, 6vw, 1.5rem);
      font-weight: 840;
    }

    .pip-main.alert .pip-time {
      color: var(--pip-alert-color);
    }

    .pip-window.alert-style-preview .pip-time,
    .pip-window.alert-style-preview .pip-unit,
    .pip-window.alert-style-preview .pip-status,
    .pip-window.alert-style-preview .pip-empty {
      color: var(--pip-alert-color);
    }

    .pip-main.waiting .pip-time,
    .pip-main.paused .pip-time {
      color: #9eaaa4;
    }

    .pip-status {
      margin-top: 8px;
      color: #88d8a9;
      font-size: 0.86rem;
      font-weight: 820;
      line-height: 1.2;
    }

    .pip-main.alert .pip-status {
      color: var(--pip-alert-color);
    }

    .pip-experience {
      display: grid;
      gap: 5px;
      width: min(100%, 300px);
      justify-self: center;
      margin-top: 6px;
      padding: 8px 9px;
      border: 1px solid rgb(var(--pip-experience-rgb) / 0.22);
      border-radius: 8px;
      background: rgb(var(--pip-experience-rgb) / 0.075);
    }

    .pip-experience.stale {
      opacity: 0.72;
    }

    .pip-experience-row {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 7px;
      min-width: 0;
    }

    .pip-experience-badge {
      color: var(--pip-experience-accent);
      font-size: 0.66rem;
      font-weight: 900;
      letter-spacing: 0;
    }

    .pip-experience-total {
      overflow: hidden;
      color: #dcebe3;
      font-size: 0.72rem;
      font-weight: 760;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .pip-experience-percent {
      color: #ffffff;
      font-size: 0.78rem;
      font-weight: 880;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .pip-experience-status {
      color: #9eb5aa;
      font-size: 0.64rem;
      font-weight: 760;
    }

    .pip-experience-track {
      position: relative;
      height: 5px;
      overflow: hidden;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.12);
    }

    .pip-experience-fill {
      position: absolute;
      inset: 0 auto 0 0;
      width: var(--pip-exp-percent);
      border-radius: inherit;
      background: linear-gradient(90deg, var(--pip-experience-accent) 0%, #5bd6e6 100%);
    }

    .pip-list {
      display: grid;
      gap: 5px;
      width: min(100%, 300px);
      min-width: 0;
      margin: 4px 0 0;
      padding: 0;
      overflow: hidden;
      list-style: none;
    }

    .pip-window.has-experience .pip-main {
      padding-bottom: 2px;
    }

    .pip-window.has-experience .pip-list {
      gap: 4px;
    }

    .pip-list-item {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 12px;
      min-height: 26px;
      padding: 0 8px;
      border: 1px solid rgba(143, 176, 159, 0.14);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.045);
    }

    .pip-list-label {
      overflow: hidden;
      color: #cedcd4;
      font-size: 0.75rem;
      font-weight: 760;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .pip-general-timer-icons {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid rgba(131, 220, 174, 0.28);
      border-radius: 8px;
      background: rgba(131, 220, 174, 0.11);
      overflow: hidden;
      vertical-align: middle;
    }

    .pip-general-timer-icons.main {
      width: 62px;
      height: 40px;
      padding-inline: 4px;
    }

    .pip-general-timer-icons.list {
      width: 44px;
      height: 28px;
      border-radius: 7px;
      padding-inline: 2px;
    }

    .pip-general-timer-icons img {
      width: 34px;
      height: 34px;
      object-fit: contain;
    }

    .pip-general-timer-icons.list img {
      width: 24px;
      height: 24px;
    }

    .pip-general-timer-icons img + img {
      margin-left: -9px;
    }

    .pip-general-timer-icons.list img + img {
      margin-left: -6px;
    }

    .pip-list-time {
      color: #ffffff;
      font-size: 0.82rem;
      font-weight: 860;
      font-variant-numeric: tabular-nums;
    }

    .pip-list-item.alert .pip-list-time {
      color: var(--pip-alert-color);
    }

    .pip-empty {
      color: #97a79e;
      font-size: 0.9rem;
      font-weight: 780;
    }

    .pip-controls {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) 38px;
      align-items: center;
      gap: 8px;
      min-width: 0;
      min-height: 34px;
      margin-top: 6px;
      padding: 5px 8px;
      border: 1px solid rgba(143, 176, 159, 0.16);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.045);
    }

    .pip-volume-icon {
      color: #aac8b8;
    }

    .pip-master-volume-slider {
      min-width: 0;
      width: 100%;
    }

    .pip-volume-value {
      color: #dcebe3;
      font-size: 0.68rem;
      font-weight: 820;
      font-variant-numeric: tabular-nums;
      text-align: right;
      white-space: nowrap;
    }

    .pip-screen-preview {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      border: 0;
      border-radius: 0;
      background: #030605;
      box-shadow: none;
      pointer-events: none;
      z-index: 0;
    }

    .pip-screen-preview::after {
      content: "";
      position: absolute;
      inset: 0;
      background:
        radial-gradient(circle at 50% 48%, rgba(6, 13, 10, 0.2), rgba(6, 13, 10, 0.58) 72%),
        linear-gradient(180deg, rgba(6, 13, 10, 0.56), rgba(6, 13, 10, 0.22) 42%, rgba(6, 13, 10, 0.68));
    }

    .pip-screen-preview-frame {
      position: absolute;
      inset: 0;
      overflow: hidden;
    }

    .pip-screen-preview.has-source-size .pip-screen-preview-frame {
      inset: auto;
      top: 50%;
      left: 50%;
      width: min(100vw, calc(100vh * var(--pip-screen-crop-aspect)));
      height: min(100vh, calc(100vw / var(--pip-screen-crop-aspect)));
      transform: translate(-50%, -50%);
    }

    .pip-screen-preview video {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: contain;
      background: #030605;
      opacity: 0.62;
    }

    .pip-screen-preview.has-source-size video {
      position: absolute;
      top: var(--pip-screen-video-top);
      left: var(--pip-screen-video-left);
      width: var(--pip-screen-video-width);
      height: var(--pip-screen-video-height);
      object-fit: fill;
    }

    .pip-screen-preview-label {
      display: none;
    }

    @keyframes pip-urgent-pulse {
      0%,
      100% {
        background: linear-gradient(160deg, #0b1511 0%, #111b17 54%, #0b0f0d 100%);
        box-shadow: inset 0 0 0 0 rgba(255, 210, 121, 0);
      }
      50% {
        background: linear-gradient(
          160deg,
          var(--pip-alert-surface) 0%,
          var(--pip-alert-surface-strong) 55%,
          #120f0a 100%
        );
        box-shadow: inset 0 0 0 6px rgb(var(--pip-alert-rgb) / 0.44);
      }
    }

    @keyframes pip-urgent-flash {
      0%,
      100% {
        color: #f4faf6;
        background: linear-gradient(160deg, #0b1511 0%, #111b17 54%, #0b0f0d 100%);
        box-shadow: inset 0 0 0 0 rgb(var(--pip-alert-rgb) / 0);
      }
      50% {
        color: var(--pip-alert-text);
        background: var(--pip-alert-color);
        box-shadow: inset 0 0 0 10px rgb(var(--pip-alert-rgb) / 0.62);
      }
    }

    @keyframes pip-screen-urgent-pulse {
      0%,
      100% {
        background: transparent;
        box-shadow: inset 0 0 0 0 rgb(var(--pip-alert-rgb) / 0);
        opacity: 0;
      }
      50% {
        background:
          radial-gradient(circle at 50% 48%, rgb(var(--pip-alert-rgb) / 0.16), transparent 62%),
          linear-gradient(160deg, rgb(var(--pip-alert-rgb) / 0.25), rgb(var(--pip-alert-rgb) / 0.08));
        box-shadow: inset 0 0 0 6px rgb(var(--pip-alert-rgb) / 0.5);
        opacity: 1;
      }
    }

    @keyframes pip-screen-urgent-flash {
      0%,
      100% {
        background: transparent;
        box-shadow: inset 0 0 0 0 rgb(var(--pip-alert-rgb) / 0);
        opacity: 0;
      }
      50% {
        background: rgb(var(--pip-alert-rgb) / 0.72);
        box-shadow: inset 0 0 0 10px rgb(var(--pip-alert-rgb) / 0.62);
        opacity: 1;
      }
    }

    @keyframes pip-urgent-text-flash {
      0%,
      100% {
        color: var(--pip-alert-color);
      }
      50% {
        color: var(--pip-alert-text);
      }
    }

    .pip-window.size-large .pip-main-label {
      font-size: clamp(0.82rem, 3.2vw, 1.1rem);
    }

    .pip-window.size-large .pip-time {
      font-size: clamp(3.25rem, 18vw, 8.2rem);
    }

    .pip-window.size-large .pip-unit {
      font-size: clamp(1.15rem, 4vw, 1.8rem);
    }

    .pip-window.size-focus {
      padding: clamp(16px, 5.5vh, 38px);
    }

    .pip-window.size-focus .pip-title {
      font-size: clamp(0.78rem, 1.7vw, 1rem);
    }

    .pip-window.size-focus .pip-main-label {
      font-size: clamp(1rem, 2.5vw, 1.55rem);
    }

    .pip-window.size-focus .pip-time-row {
      gap: clamp(8px, 1.8vw, 18px);
      margin-top: clamp(8px, 1.4vh, 18px);
    }

    .pip-window.size-focus .pip-time {
      font-size: clamp(5.4rem, 17vw, 13rem);
      text-shadow: 0 18px 46px rgba(0, 0, 0, 0.42);
    }

    .pip-window.size-focus .pip-unit {
      font-size: clamp(1.4rem, 3vw, 2.25rem);
    }

    .pip-window.size-focus .pip-status {
      margin-top: clamp(10px, 1.8vh, 22px);
      font-size: clamp(1rem, 1.9vw, 1.35rem);
    }

    .pip-window.size-focus .pip-list,
    .pip-window.size-focus .pip-experience {
      width: min(100%, 520px);
    }

    .pip-window.size-focus .pip-list-item {
      min-height: 34px;
      padding-inline: 12px;
    }

    @media (max-width: 300px), (max-height: 210px) {
      .pip-window {
        padding: 8px;
      }

      .pip-alert-toggle,
      .pip-close-button {
        width: 24px;
        height: 24px;
        border-radius: 7px;
      }

      .pip-controls {
        min-height: 28px;
        margin-top: 4px;
        padding-block: 3px;
      }

      .pip-main {
        padding-top: 4px;
      }

      .pip-time-row {
        margin-top: 2px;
      }

      .pip-status {
        margin-top: 5px;
        font-size: 0.75rem;
      }

      .pip-experience {
        margin-top: 6px;
        padding: 6px 7px;
      }

      .pip-list {
        gap: 3px;
      }

      .pip-list-item {
        min-height: 22px;
      }

    }

    @media (max-height: 280px) {
      .pip-window.has-experience .pip-list-item:nth-child(n + 2) {
        display: none;
      }

      .pip-window.has-experience .pip-experience {
        padding-block: 6px;
      }
    }
  `;
}

function PipListTime({ item }: { item: PipTimerItem }) {
  if (item.secondsUntilAlert === null) {
    return <strong className="pip-list-time">{item.statusLabel}</strong>;
  }

  return (
    <strong className="pip-list-time">
      {formatTimerSeconds(item.secondsUntilAlert)}
      {getTimerUnit(item.secondsUntilAlert)}
    </strong>
  );
}

function PipItemLabel({
  item,
  variant,
}: {
  item: PipTimerItem;
  variant: "main" | "list";
}) {
  if (item.kind !== "general-timer" || !item.iconPaths?.length) {
    return <>{item.label}</>;
  }

  return (
    <span className={`pip-general-timer-icons ${variant}`} aria-label={item.label}>
      {item.iconPaths.map((iconPath) => (
        <img key={iconPath} src={iconPath} alt="" draggable={false} />
      ))}
    </span>
  );
}

function PipHuntStallStrip({ huntStall }: { huntStall: PipHuntStallInfo }) {
  return (
    <div
      className={`pip-experience${huntStall.isStale ? " stale" : ""}`}
      aria-label={huntStall.ariaLabel}
    >
      <div className="pip-experience-row">
        <span className="pip-experience-badge">{huntStall.badgeLabel}</span>
        <span className="pip-experience-total">{huntStall.primaryLabel}</span>
        <strong className="pip-experience-percent">{huntStall.secondaryLabel}</strong>
      </div>
      <div
        className="pip-experience-track"
        aria-hidden="true"
        style={{ "--pip-exp-percent": `${huntStall.progressPercent}%` } as CSSProperties}
      >
        <span className="pip-experience-fill" />
      </div>
      <span className="pip-experience-status">{huntStall.statusLabel}</span>
    </div>
  );
}

type PipScreenPreviewStyle = CSSProperties & {
  "--pip-screen-crop-aspect"?: string;
  "--pip-screen-video-width"?: string;
  "--pip-screen-video-height"?: string;
  "--pip-screen-video-left"?: string;
  "--pip-screen-video-top"?: string;
};

function getStreamVideoSize(stream: MediaStream): CaptureSize | null {
  if (typeof stream.getVideoTracks !== "function") {
    return null;
  }

  const settings = stream.getVideoTracks()[0]?.getSettings();
  if (typeof settings?.width !== "number" || typeof settings.height !== "number") {
    return null;
  }

  return {
    width: Math.round(settings.width),
    height: Math.round(settings.height),
  };
}

function getPipScreenPreviewStyle(crop: GameViewportCrop): PipScreenPreviewStyle {
  return {
    "--pip-screen-crop-aspect": String(crop.width / crop.height),
    "--pip-screen-video-width": `${(crop.source.width / crop.width) * 100}%`,
    "--pip-screen-video-height": `${(crop.source.height / crop.height) * 100}%`,
    "--pip-screen-video-left": `${-(crop.x / crop.width) * 100}%`,
    "--pip-screen-video-top": `${-(crop.y / crop.height) * 100}%`,
  };
}

function PipScreenPreview({
  stream,
  sourceSize,
}: {
  stream: MediaStream;
  sourceSize: CaptureSize | null;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [metadataSize, setMetadataSize] = useState<CaptureSize | null>(null);
  const streamSize = useMemo(() => getStreamVideoSize(stream), [stream]);
  const effectiveSourceSize = sourceSize ?? metadataSize ?? streamSize;
  const viewportCrop = useMemo(
    () => getLikelyGameViewportCrop(effectiveSourceSize),
    [effectiveSourceSize],
  );
  const previewStyle = viewportCrop ? getPipScreenPreviewStyle(viewportCrop) : undefined;
  const previewClassName = [
    "pip-screen-preview",
    viewportCrop ? "has-source-size" : "",
    viewportCrop?.isCropped ? "has-crop" : "",
  ]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    const video = videoRef.current;
    setMetadataSize(null);
    if (!video) {
      return;
    }

    video.srcObject = stream;
    const playResult = video.play();
    if (playResult && typeof playResult.catch === "function") {
      void playResult.catch(() => {
        // The PiP document may need a short moment before autoplay is accepted.
      });
    }

    return () => {
      if (video.srcObject === stream) {
        video.srcObject = null;
      }
    };
  }, [stream]);

  return (
    <figure className={previewClassName} aria-label="공유 화면 미리보기" style={previewStyle}>
      <div className="pip-screen-preview-frame">
        <video
          ref={videoRef}
          aria-label="공유 화면"
          muted
          playsInline
          autoPlay
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            if (video.videoWidth > 0 && video.videoHeight > 0) {
              setMetadataSize({
                width: video.videoWidth,
                height: video.videoHeight,
              });
            }
          }}
        />
      </div>
      <figcaption className="pip-screen-preview-label">공유 화면</figcaption>
    </figure>
  );
}

function getPipWindowAlertTheme(config: PipTimerConfig, main: PipTimerItem | null) {
  if (config.mode === "specialCore" || main?.kind === "special-core") {
    return getPipTimerAlertColorTheme(config.alertColor);
  }

  const itemKey = main ? PIP_VISIBLE_ITEM_KEY_BY_KIND[main.kind] : null;
  const alertColor = itemKey
    ? config.itemAlertColors[itemKey] ?? config.alertColor
    : config.alertColor;
  return getPipTimerAlertColorTheme(alertColor);
}

/**
 * A blinking window is an attention signal, so it has to end. An alert state
 * can outlive its usefulness by minutes — a skill whose cooldown is longer
 * than its buff stays "needs recast" until the cooldown ends — and a window
 * that blinks that whole time reads as noise instead of a signal. After this
 * delay the window keeps its alert colour but stops animating; a different
 * item entering alert starts a fresh blink.
 */
export const PIP_ALERT_BLINK_SETTLE_MS = 10_000;

function isAlertingItem(item: PipTimerItem): boolean {
  return Boolean(item.isUrgent) || item.secondsUntilAlert === 0;
}

function usePipAlertBlinkSettled({
  alertingId,
  alertingIds,
  disabled,
}: {
  alertingId: string | null;
  alertingIds: Set<string>;
  disabled: boolean;
}): boolean {
  const [isSettled, setSettled] = useState(false);
  const alertStartsRef = useRef(new Map<string, number>());

  useEffect(() => {
    if (disabled || !alertingId) {
      alertStartsRef.current.clear();
      setSettled(false);
      return;
    }

    for (const id of [...alertStartsRef.current.keys()]) {
      if (!alertingIds.has(id)) {
        alertStartsRef.current.delete(id);
      }
    }

    const now = Date.now();
    const startedAt = alertStartsRef.current.get(alertingId) ?? now;
    alertStartsRef.current.set(alertingId, startedAt);

    const remainingMs = PIP_ALERT_BLINK_SETTLE_MS - (now - startedAt);
    if (remainingMs <= 0) {
      setSettled(true);
      return;
    }

    setSettled(false);
    const settleTimer = window.setTimeout(() => setSettled(true), remainingMs);
    return () => window.clearTimeout(settleTimer);
  }, [alertingId, alertingIds, disabled]);

  return isSettled;
}

export function PipTimerWindow({
  config = DEFAULT_PIP_TIMER_CONFIG,
  display,
  isAlertStylePreview = false,
  isSettingsPreview = false,
  screenPreviewStream = null,
  screenPreviewSize = null,
  isAllAlertsDisabled = false,
  canToggleAllAlerts = true,
  masterVolume = 1,
  onToggleAllAlertsDisabled = () => undefined,
  onMasterVolumeChange = () => undefined,
  onClose,
}: {
  config?: PipTimerConfig;
  display: PipTimerDisplay;
  isAlertStylePreview?: boolean;
  isSettingsPreview?: boolean;
  screenPreviewStream?: MediaStream | null;
  screenPreviewSize?: CaptureSize | null;
  isAllAlertsDisabled?: boolean;
  canToggleAllAlerts?: boolean;
  masterVolume?: number;
  onToggleAllAlertsDisabled?: (disabled: boolean) => void;
  onMasterVolumeChange?: (volume: number) => void;
  onClose: () => void;
}) {
  const main = display.main;
  const huntStall = display.huntStall;
  const secondaryLimit = isSettingsPreview ? 3 : huntStall ? 2 : 3;
  const secondaryItems = display.items
    .filter((item) => item.id !== main?.id)
    .slice(0, secondaryLimit);
  const mainSecondsUntilAlert = main?.secondsUntilAlert;
  const isUrgent =
    isAlertStylePreview ||
    Boolean(main?.isUrgent) ||
    (typeof mainSecondsUntilAlert === "number" &&
      mainSecondsUntilAlert <= 0);
  const isCritical =
    !isAlertStylePreview &&
    isUrgent &&
    typeof mainSecondsUntilAlert === "number" &&
    mainSecondsUntilAlert <= 0;
  const alertingIds = useMemo(
    () => new Set(display.items.filter(isAlertingItem).map((item) => item.id)),
    [display.items],
  );
  const isAlertBlinkSettled = usePipAlertBlinkSettled({
    alertingId: isUrgent && main ? main.id : null,
    alertingIds,
    disabled: isAlertStylePreview || isSettingsPreview,
  });
  const alertTheme = getPipWindowAlertTheme(config, main);
  const experienceTheme = getPipTimerAlertColorTheme(
    config.itemAlertColors.experience ?? config.alertColor,
  );
  const shouldShowScreenPreview =
    config.mode !== "specialCore" &&
    Boolean(config.showScreenPreview) &&
    Boolean(screenPreviewStream);
  const normalizedMasterVolume = clampMasterVolume(masterVolume);
  const masterVolumePercent = Math.round(normalizedMasterVolume * 100);
  const masterVolumeLabel = getMasterVolumePercentLabel(normalizedMasterVolume);

  return (
    <div
      className={`pip-window size-${config.size} emphasis-${config.emphasis}${
        huntStall ? " has-experience" : ""
      }${shouldShowScreenPreview ? " with-screen-preview" : ""
      }${isAlertStylePreview ? " alert-style-preview" : ""
      }${
        isUrgent ? " urgent" : ""
      }${isCritical ? " critical" : ""}${
        isAlertBlinkSettled ? " alert-settled" : ""
      }`}
      data-astryx-theme="neutral"
      style={
        {
          "--pip-alert-color": alertTheme.accent,
          "--pip-alert-rgb": alertTheme.accentRgb,
          "--pip-alert-surface": alertTheme.surface,
          "--pip-alert-surface-strong": alertTheme.surfaceStrong,
          "--pip-alert-text": alertTheme.text,
          "--pip-experience-accent": experienceTheme.accent,
          "--pip-experience-rgb": experienceTheme.accentRgb,
        } as CSSProperties
      }
    >
      <div className="pip-header">
        <span className="pip-title">Maple Timer</span>
        <div className="pip-header-actions">
          <button
            className={`pip-alert-toggle${isAllAlertsDisabled ? " is-active" : ""}`}
            type="button"
            aria-label={isAllAlertsDisabled ? "전체 알림 다시 활성화" : "전체 알림 비활성화"}
            aria-pressed={isAllAlertsDisabled}
            title={isAllAlertsDisabled ? "전체 알림 다시 활성화" : "전체 알림 비활성화"}
            disabled={!canToggleAllAlerts}
            onClick={() => onToggleAllAlertsDisabled(!isAllAlertsDisabled)}
          >
            {isAllAlertsDisabled ? <BellOff size={16} /> : <Bell size={16} />}
          </button>
          <button
            className="pip-close-button"
            type="button"
            aria-label="PIP 타이머 닫기"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {main ? (
        <div className={`pip-main ${main.tone}`}>
          <div className="pip-main-label">
            <PipItemLabel item={main} variant="main" />
          </div>
          <div className="pip-time-row">
            <strong className="pip-time">{formatTimerSeconds(main.secondsUntilAlert)}</strong>
            <span className="pip-unit">{getTimerUnit(main.secondsUntilAlert)}</span>
          </div>
          <span className="pip-status">{main.statusLabel}</span>

          {secondaryItems.length > 0 && (
            <ul className="pip-list">
              {secondaryItems.map((item) => (
                <li className={`pip-list-item ${item.tone}`} key={item.id}>
                  <span className="pip-list-label">
                    <PipItemLabel item={item} variant="list" />
                  </span>
                  <PipListTime item={item} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="pip-main waiting">
          <span className="pip-empty">
            {isAllAlertsDisabled
              ? "모든 알림이 비활성화되었습니다."
              : "감시할 항목이 없습니다."}
          </span>
        </div>
      )}
      {huntStall && <PipHuntStallStrip huntStall={huntStall} />}
      <div className="pip-controls">
        <Volume2 className="pip-volume-icon" size={16} aria-hidden />
        <Slider
          className="pip-master-volume-slider"
          label="마스터 볼륨"
          isLabelHidden
          value={masterVolumePercent}
          min={0}
          max={100}
          step={5}
          width="100%"
          valueDisplay="none"
          formatValue={(value) => `${value}%`}
          onChange={(value: number) => onMasterVolumeChange(value / 100)}
        />
        <strong className="pip-volume-value">{masterVolumeLabel}</strong>
      </div>
      {shouldShowScreenPreview && screenPreviewStream ? (
        <PipScreenPreview stream={screenPreviewStream} sourceSize={screenPreviewSize} />
      ) : null}
    </div>
  );
}

export function injectPipStyles(pipWindow: Window) {
  document.querySelectorAll('link[rel="stylesheet"], style').forEach((styleNode) => {
    pipWindow.document.head.appendChild(styleNode.cloneNode(true));
  });

  const style = pipWindow.document.createElement("style");
  const fontUrl = new URL("/fonts/PretendardVariable.woff2", window.location.origin).href;
  style.textContent = getPipStyles(fontUrl);
  pipWindow.document.head.appendChild(style);
}
