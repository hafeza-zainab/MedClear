"use client";

import { useEffect, useMemo, useState } from "react";
import type { Analysis, Medicine } from "@/lib/medical";

const slots = [
  { id: "morning", label: "Morning", icon: "☀", defaultTime: "08:00" },
  { id: "afternoon", label: "Afternoon", icon: "◷", defaultTime: "13:00" },
  { id: "evening", label: "Evening", icon: "◒", defaultTime: "18:00" },
  { id: "night", label: "Night", icon: "☾", defaultTime: "21:00" },
] as const;
type SlotId = (typeof slots)[number]["id"];

function getDoseSlots(medicine: Medicine): SlotId[] {
  const timing = medicine.timing.toLowerCase();
  const matched = slots.filter((slot) => {
    const words: Record<SlotId, RegExp> = {
      morning: /morning|breakfast/,
      afternoon: /afternoon|lunch/,
      evening: /evening|dinner/,
      night: /night|bedtime/,
    };
    return words[slot.id].test(timing);
  }).map((slot) => slot.id);
  if (matched.length) return matched;
  if (!medicine.frequency_per_day) return [];
  const count = Math.min(medicine.frequency_per_day, slots.length);
  const suggestions: Record<number, SlotId[]> = {
    1: ["morning"],
    2: ["morning", "evening"],
    3: ["morning", "afternoon", "evening"],
    4: ["morning", "afternoon", "evening", "night"],
  };
  return suggestions[count] ?? slots.slice(0, count).map((slot) => slot.id);
}

function todayKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function Schedule({ analysis }: { analysis: Analysis }) {
  const [taken, setTaken] = useState<Record<string, boolean>>({});
  const [reminderOn, setReminderOn] = useState(false);
  const [reminderTimes, setReminderTimes] = useState<Record<SlotId, string>>({
    morning: "08:00", afternoon: "13:00", evening: "18:00", night: "21:00",
  });
  const [message, setMessage] = useState("");

  const schedule = useMemo(() => {
    const groups = Object.fromEntries(slots.map((slot) => [slot.id, [] as { medicine: Medicine; index: number; suggested: boolean }[]])) as Record<SlotId, { medicine: Medicine; index: number; suggested: boolean }[]>;
    analysis.medicines.forEach((medicine, index) => {
      const doseSlots = getDoseSlots(medicine);
      const suggested = !slots.some((slot) => new RegExp(slot.id === "morning" ? "morning|breakfast" : slot.id === "afternoon" ? "afternoon|lunch" : slot.id === "evening" ? "evening|dinner" : "night|bedtime", "i").test(medicine.timing));
      doseSlots.forEach((slot) => groups[slot].push({ medicine, index, suggested }));
    });
    return groups;
  }, [analysis]);

  useEffect(() => {
    const rawTaken = localStorage.getItem(`medclear-taken-${todayKey()}`);
    const rawTimes = localStorage.getItem("medclear-reminder-times");
    if (rawTaken) try { setTaken(JSON.parse(rawTaken)); } catch { /* Ignore broken local state. */ }
    if (rawTimes) try { setReminderTimes((current) => ({ ...current, ...JSON.parse(rawTimes) })); } catch { /* Ignore broken local state. */ }
    setReminderOn(localStorage.getItem("medclear-reminders-enabled") === "true");
  }, []);

  useEffect(() => {
    localStorage.setItem(`medclear-taken-${todayKey()}`, JSON.stringify(taken));
  }, [taken]);

  useEffect(() => {
    localStorage.setItem("medclear-reminder-times", JSON.stringify(reminderTimes));
  }, [reminderTimes]);

  useEffect(() => {
    if (!reminderOn || Notification.permission !== "granted") return;
    const checkReminder = () => {
      const now = new Date();
      const current = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      for (const slot of slots) {
        if (reminderTimes[slot.id] !== current || !schedule[slot.id].length) continue;
        const reminderKey = `medclear-reminded-${todayKey()}-${slot.id}`;
        if (localStorage.getItem(reminderKey)) continue;
        const medicines = schedule[slot.id].map((dose) => dose.medicine.name).join(", ");
        new Notification(`MedClear · ${slot.label}`, { body: `Check your schedule: ${medicines}. Follow your prescription.` });
        localStorage.setItem(reminderKey, "true");
      }
    };
    checkReminder();
    const timer = window.setInterval(checkReminder, 30_000);
    return () => window.clearInterval(timer);
  }, [reminderOn, reminderTimes, schedule]);

  async function enableReminders() {
    if (!("Notification" in window)) return setMessage("Notifications are not supported in this browser.");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setReminderOn(false);
      localStorage.setItem("medclear-reminders-enabled", "false");
      return setMessage("Notifications were not enabled. You can still use the schedule here.");
    }
    setReminderOn(true);
    localStorage.setItem("medclear-reminders-enabled", "true");
    setMessage("Reminders are on while this page is open.");
  }

  function toggleDose(key: string) {
    setTaken((current) => ({ ...current, [key]: !current[key] }));
  }

  return (
    <section id="step-schedule" className="schedule-section" aria-labelledby="schedule-title" data-tour="schedule-section">
      <div className="schedule-heading-row">
        <div><div className="eyebrow"><span className="eyebrow-dot" /> Daily plan</div><h2 id="schedule-title">Your day at a glance</h2></div>
        <button className="print-button" type="button" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>
      <p className="schedule-note">Follow the instructions on your prescription. Suggested time slots are only a planning aid; confirm timing with your doctor or pharmacist.</p>
      <div className="reminder-panel">
        <div className="reminder-topline">
          <div><strong>Browser reminders</strong><p>Reminders work while this page stays open.</p></div>
          <button className={`reminder-toggle${reminderOn ? " is-on" : ""}`} type="button" onClick={enableReminders} aria-pressed={reminderOn}>{reminderOn ? "On" : "Turn on"}</button>
        </div>
        <div className="reminder-times">
          {slots.map((slot) => <label key={slot.id}>{slot.label}<input type="time" value={reminderTimes[slot.id]} onChange={(event) => setReminderTimes((current) => ({ ...current, [slot.id]: event.target.value }))} /></label>)}
        </div>
        {message && <p className="reminder-message" role="status">{message}</p>}
      </div>
      <div className="timeline">
        {slots.map((slot) => (
          <section className="timeline-group" key={slot.id} aria-labelledby={`slot-${slot.id}`} data-tour={`schedule-${slot.id}`}>
            <div className="timeline-label"><span className="timeline-icon" aria-hidden="true">{slot.icon}</span><div><h3 id={`slot-${slot.id}`}>{slot.label}</h3><span>{reminderTimes[slot.id]}</span></div></div>
            <div className="timeline-doses">
              {schedule[slot.id].length ? schedule[slot.id].map(({ medicine, index, suggested }) => {
                const key = `${index}-${slot.id}`;
                const timing = medicine.timing;
                const food = /before food|before meals|empty stomach/i.test(timing) ? "Before food" : /after food|after meals|with food/i.test(timing) ? "After food" : "Follow label";
                return <div className={`dose-item${taken[key] ? " dose-taken" : ""}`} key={key}>
                  <div className="dose-main"><strong>{medicine.name || "Medicine name unclear"}</strong>{medicine.strength && <span>{medicine.strength}</span>}<span className="dose-food"><span aria-hidden="true">🍽</span> {food}</span>{suggested && <span className="suggested-badge">Suggested slot</span>}</div>
                  <label className="taken-check"><input type="checkbox" data-tour={`dose-check-${slot.id}-${index}`} checked={!!taken[key]} onChange={() => toggleDose(key)} /><span>Mark as taken</span></label>
                </div>;
              }) : <p className="no-dose">No dose timing was identified for this time of day.</p>}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
