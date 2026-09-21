/**
 * Guided "Start" flow: the step bar, summary, question and option cards inside the selection panel.
 * Pure rendering; wheel.js owns the state (selected breadcrumb + whether the flow was started).
 */

/** Question asked at each depth: nothing chosen, core chosen, middle ring chosen. */
const STEP_QUESTIONS = ["Which of these is closest right now?", "Which kind?", "Which fits best?"];
const LEAF_DEPTH = 3;

/**
 * @typedef {{ label: string; crumb: string; desc: string; color: string }} FlowOption
 * @typedef {{
 *   visible: boolean;
 *   depth: number;            // how many rings are chosen so far (0-3)
 *   summary: string;          // one-line description of the current choice, if any
 *   options: FlowOption[];    // next ring's choices; empty on a leaf
 *   onPick: (crumb: string) => void;
 * }} FlowPanelState
 */

/** @param {FlowPanelState} state */
export function renderFlowPanel({ visible, depth, summary, options, onPick }) {
  const bar = document.getElementById("wheel-flow-bar");
  const summaryEl = document.getElementById("wheel-selection-summary");
  const questionEl = document.getElementById("wheel-flow-question");
  const optionsEl = document.getElementById("wheel-flow-options");
  if (!bar || !summaryEl || !questionEl || !optionsEl) return;

  bar.hidden = !visible;
  // The step being answered; a finished path keeps the last step lit.
  const activeStep = Math.min(depth + 1, LEAF_DEPTH);
  for (let step = 1; step <= LEAF_DEPTH; step++) {
    const chip = document.getElementById(`wheel-flow-step-${step}`);
    if (!chip) continue;
    chip.classList.toggle("is-active", visible && step === activeStep);
    chip.classList.toggle("is-done", visible && step <= depth && step !== activeStep);
    if (visible && step === activeStep) chip.setAttribute("aria-current", "step");
    else chip.removeAttribute("aria-current");
  }

  summaryEl.textContent = summary;
  summaryEl.hidden = !visible || !summary;

  const hasOptions = visible && options.length > 0;
  questionEl.textContent = hasOptions ? (STEP_QUESTIONS[depth] ?? "") : "";
  questionEl.hidden = !hasOptions || depth === 0; // at depth 0 the panel title already is the question
  optionsEl.hidden = !hasOptions;
  optionsEl.innerHTML = "";
  if (!hasOptions) return;

  for (const opt of options) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "flow-option";

    const dot = document.createElement("span");
    dot.className = "flow-option__dot";
    dot.style.background = opt.color;
    dot.setAttribute("aria-hidden", "true");

    const text = document.createElement("span");
    text.className = "flow-option__text";
    const name = document.createElement("span");
    name.className = "flow-option__name";
    name.textContent = opt.label;
    text.appendChild(name);
    if (opt.desc) {
      const desc = document.createElement("span");
      desc.className = "flow-option__desc";
      desc.textContent = opt.desc;
      text.appendChild(desc);
    }

    btn.append(dot, text);
    btn.addEventListener("click", () => onPick(opt.crumb));
    optionsEl.appendChild(btn);
  }
}

export const FIRST_QUESTION = STEP_QUESTIONS[0];
