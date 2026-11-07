"use client";

export default function DemoStartButton() {
  return (
    <button
      className="watch-demo-button"
      type="button"
      data-tour="watch-demo"
      onClick={() => window.dispatchEvent(new Event("medclear:start-demo"))}
    >
      ▶ Watch demo
    </button>
  );
}
