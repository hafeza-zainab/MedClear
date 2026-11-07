"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import scenes from "@/data/demo-scenes.json";

const PACE = 1.25;
const TOUR_KEY = "medclear-demo-tour-state";
const MUTE_KEY = "medclear-demo-muted";
const SCENE_DURATIONS_MS = [8000, 8000, 5000, 8000, 7000, 12000, 10000, 8000, 10000, 8000];
const TOUR_STORAGE_KEYS = ["medclear-analysis", "medclear-demo"] as const;

type Scene = (typeof scenes)[number];
type StorageSnapshot = Record<string, string | null>;
type TourState = {
  step: number;
  startedAt: number;
  language: string | null;
  takenKey: string;
  takenValue: string | null;
  session: StorageSnapshot;
};

function todayKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function wait(ms: number, signal: AbortSignal) {
  const duration = Math.max(0, ms * PACE);
  return new Promise<void>((resolve, reject) => {
    let remaining = duration;
    const slice = () => {
      if (signal.aborted) return reject(new Error("stopped"));
      if (remaining <= 0) return resolve();
      const amount = Math.min(50, remaining);
      window.setTimeout(() => {
        remaining -= amount;
        slice();
      }, amount);
    };
    slice();
  });
}

async function waitFor(selector: string, signal: AbortSignal) {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    if (signal.aborted) throw new Error("stopped");
    const element = document.querySelector<HTMLElement>(selector);
    if (element) return element;
    await wait(50, signal);
  }
  throw new Error(`Tour target not found within 5 seconds: ${selector}`);
}

function click(element: HTMLElement) {
  element.click();
}

function selectValue(element: HTMLElement, value: string) {
  if (!(element instanceof HTMLSelectElement)) throw new Error("Tour language switcher is not a select control.");
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

export default function DemoTour() {
  const router = useRouter();
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const tourRef = useRef<TourState | null>(null);
  const mutedRef = useRef(false);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeAudioDoneRef = useRef<(() => void) | null>(null);
  const preloadedAudioRef = useRef<{ id: string; audio: HTMLAudioElement } | null>(null);
  const highlightedRef = useRef<HTMLElement | null>(null);
  const runStartedRef = useRef(false);
  const finishCalledRef = useRef(false);

  const releaseAudio = useCallback(() => {
    const current = activeAudioRef.current;
    activeAudioRef.current = null;
    if (current) {
      current.pause();
      current.removeAttribute("src");
      current.load();
    }
    activeAudioDoneRef.current?.();
    activeAudioDoneRef.current = null;
    const next = preloadedAudioRef.current?.audio;
    if (next) {
      next.pause();
      next.removeAttribute("src");
      next.load();
    }
    preloadedAudioRef.current = null;
  }, []);

  const focusOn = useCallback((element: HTMLElement) => {
    highlightedRef.current?.classList.remove("tour-highlight");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center", inline: "nearest" });
    element.classList.add("tour-highlight");
    highlightedRef.current = element;
  }, []);

  const finish = useCallback(() => {
    if (finishCalledRef.current) return;
    finishCalledRef.current = true;
    releaseAudio();
    highlightedRef.current?.classList.remove("tour-highlight");
    highlightedRef.current = null;
    const saved = tourRef.current;
    if (saved) {
      if (saved.language === null) localStorage.removeItem("medclear-language");
      else localStorage.setItem("medclear-language", saved.language);
      if (saved.takenValue === null) localStorage.removeItem(saved.takenKey);
      else localStorage.setItem(saved.takenKey, saved.takenValue);
      for (const key of TOUR_STORAGE_KEYS) {
        const value = saved.session[key];
        if (value === null || value === undefined) sessionStorage.removeItem(key);
        else sessionStorage.setItem(key, value);
      }
    }
    sessionStorage.removeItem(TOUR_KEY);
    tourRef.current = null;
    abortRef.current = null;
    runStartedRef.current = false;
    setActive(false);
    setStep(0);
    if (window.location.pathname !== "/") router.push("/");
  }, [releaseAudio, router]);

  const preload = useCallback((scene: Scene | undefined) => {
    if (!scene || mutedRef.current) return;
    if (preloadedAudioRef.current?.id === scene.id) return;
    const audio = new Audio(`/audio/${scene.id}.mp3`);
    audio.preload = "auto";
    audio.load();
    preloadedAudioRef.current = { id: scene.id, audio };
  }, []);

  const playNarration = useCallback((scene: Scene): Promise<void> => {
    if (mutedRef.current) return Promise.resolve();
    const preloaded = preloadedAudioRef.current?.id === scene.id ? preloadedAudioRef.current.audio : null;
    preloadedAudioRef.current = null;
    const audio = preloaded ?? new Audio(`/audio/${scene.id}.mp3`);
    audio.preload = "auto";
    activeAudioRef.current = audio;
    return new Promise((resolve) => {
      let settled = false;
      let timeout = 0;
      const settle = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        audio.removeEventListener("ended", settle);
        audio.removeEventListener("error", settle);
        if (activeAudioRef.current === audio) activeAudioRef.current = null;
        if (activeAudioDoneRef.current === settle) activeAudioDoneRef.current = null;
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        resolve();
      };
      activeAudioDoneRef.current = settle;
      audio.addEventListener("ended", settle, { once: true });
      audio.addEventListener("error", settle, { once: true });
      timeout = window.setTimeout(settle, 30_000);
      audio.play().catch(settle);
    });
  }, []);

  const saveTour = useCallback((next: TourState) => {
    tourRef.current = next;
    sessionStorage.setItem(TOUR_KEY, JSON.stringify(next));
  }, []);

  const runTour = useCallback(async (initialState: TourState) => {
    if (runStartedRef.current) return;
    runStartedRef.current = true;
    finishCalledRef.current = false;
    const controller = new AbortController();
    abortRef.current = controller;
    const signal = controller.signal;
    try {
      setActive(true);
      setStartedAt(initialState.startedAt);
      setStep(initialState.step);
      for (let index = initialState.step; index < scenes.length; index += 1) {
        if (signal.aborted) throw new Error("stopped");
        const scene = scenes[index];
        saveTour({ ...initialState, step: index });
        setStep(index);
        await waitFor('[data-tour="demo-caption"]', signal);
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        const sceneStarted = Date.now();
        const audioDone = playNarration(scene);
        preload(scenes[index + 1]);

        if (scene.id === "scene_01") {
          focusOn(await waitFor('[data-tour="landing-hero"]', signal));
          focusOn(await waitFor('[data-tour="landing-disclaimer"]', signal));
        } else if (scene.id === "scene_02") {
          router.push("/scan");
          focusOn(await waitFor('[data-tour="scan-preview"]', signal));
        } else if (scene.id === "scene_03") {
          const sampleButton = document.querySelector<HTMLElement>('[data-tour="sample-button"]');
          if (sampleButton) click(sampleButton);
          await waitFor('[data-tour="medicine-card-0"]', signal);
        } else if (scene.id === "scene_04") {
          focusOn(await waitFor('[data-tour="medicine-card-0"]', signal));
        } else if (scene.id === "scene_05") {
          focusOn(await waitFor('[data-tour="unreadable-section"]', signal));
        } else if (scene.id === "scene_06") {
          focusOn(await waitFor('[data-tour="schedule-section"]', signal));
          focusOn(await waitFor('[data-tour="schedule-morning"]', signal));
          const morningDose = await waitFor('[data-tour="dose-check-morning-1"]', signal);
          if (morningDose instanceof HTMLInputElement && !morningDose.checked) click(morningDose);
          focusOn(await waitFor('[data-tour="schedule-afternoon"]', signal));
          const afternoonDose = await waitFor('[data-tour="dose-check-afternoon-2"]', signal);
          if (afternoonDose instanceof HTMLInputElement && !afternoonDose.checked) click(afternoonDose);
          focusOn(await waitFor('[data-tour="schedule-night"]', signal));
        } else if (scene.id === "scene_07") {
          focusOn(await waitFor('[data-tour="safety-duplicate"]', signal));
        } else if (scene.id === "scene_08") {
          focusOn(await waitFor('[data-tour="safety-interaction"]', signal));
        } else if (scene.id === "scene_09") {
          const language = await waitFor('[data-tour="language-switcher"]', signal);
          focusOn(language);
          selectValue(language, "hi");
          await wait(3500, signal);
          selectValue(language, "mr");
        } else {
          focusOn(await waitFor('[data-tour="closing-disclaimer"]', signal));
        }

        const scriptedRemaining = SCENE_DURATIONS_MS[index] * PACE - (Date.now() - sceneStarted);
        if (scriptedRemaining > 0) await wait(scriptedRemaining / PACE, signal);
        await audioDone;
      }
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "stopped") console.error("MedClear demo tour ended early", error);
    } finally {
      finish();
    }
  }, [finish, focusOn, playNarration, preload, router, saveTour]);

  const start = useCallback(() => {
    if (runStartedRef.current) return;
    const takenKey = `medclear-taken-${todayKey()}`;
    const session: StorageSnapshot = {};
    for (const key of TOUR_STORAGE_KEYS) session[key] = sessionStorage.getItem(key);
    const initial: TourState = {
      step: 0,
      startedAt: Date.now(),
      language: localStorage.getItem("medclear-language"),
      takenKey,
      takenValue: localStorage.getItem(takenKey),
      session,
    };
    saveTour(initial);
    localStorage.setItem("medclear-language", "en");
    const savedMuted = sessionStorage.getItem(MUTE_KEY) === "true";
    mutedRef.current = savedMuted;
    setMuted(savedMuted);
    void runTour(initial);
  }, [runTour, saveTour]);

  useEffect(() => {
    const onStart = () => start();
    window.addEventListener("medclear:start-demo", onStart);
    return () => window.removeEventListener("medclear:start-demo", onStart);
  }, [start]);

  useEffect(() => {
    if (runStartedRef.current) return;
    const saved = sessionStorage.getItem(TOUR_KEY);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as TourState;
      if (!Array.isArray(scenes) || parsed.step < 0 || parsed.step >= scenes.length) throw new Error("Invalid saved demo state");
      tourRef.current = parsed;
      const savedMuted = sessionStorage.getItem(MUTE_KEY) === "true";
      mutedRef.current = savedMuted;
      setMuted(savedMuted);
      void runTour(parsed);
    } catch {
      sessionStorage.removeItem(TOUR_KEY);
    }
  }, [runTour, pathname]);

  useEffect(() => {
    if (!active || !startedAt) return;
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [active, startedAt]);

  useEffect(() => {
    const releaseOnPageExit = () => releaseAudio();
    window.addEventListener("pagehide", releaseOnPageExit);
    window.addEventListener("beforeunload", releaseOnPageExit);
    return () => {
      window.removeEventListener("pagehide", releaseOnPageExit);
      window.removeEventListener("beforeunload", releaseOnPageExit);
      releaseAudio();
    };
  }, [releaseAudio]);

  function stop() {
    abortRef.current?.abort();
    releaseAudio();
  }

  function toggleMute() {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    sessionStorage.setItem(MUTE_KEY, String(next));
    if (next) releaseAudio();
  }

  if (!active) return null;
  const scene = scenes[step];
  const percent = ((step + 1) / scenes.length) * 100;
  const minutes = Math.floor(elapsed / 60);
  const seconds = String(elapsed % 60).padStart(2, "0");

  return (
      <div className="demo-caption-bar" role="status" aria-live="polite" aria-atomic="true" data-tour="demo-caption">
      <div className="demo-progress-track" aria-hidden="true"><span style={{ width: `${percent}%` }} /></div>
      <div className="demo-caption-content">
        <div className="demo-caption-text"><strong>Step {step + 1}/{scenes.length}</strong><span>{scene.caption}</span></div>
        <div className="demo-controls">
          <span className="demo-elapsed" aria-label={`Elapsed ${minutes} minutes ${seconds} seconds`}>{minutes}:{seconds}</span>
          <button className="demo-control-button" type="button" data-tour="demo-mute-toggle" aria-pressed={muted} onClick={toggleMute}>{muted ? "Unmute" : "Mute"}</button>
          <button className="demo-control-button demo-stop-button" type="button" data-tour="demo-stop" onClick={stop}>Stop demo</button>
        </div>
      </div>
    </div>
  );
}
