import { LEVELS } from "../../shared/challenges";

const levelsEl = document.getElementById("ctf-levels")!;

let currentLevel = 1; // lowest unsolved level id; 0 = all done
let solved: number[] = [];

/** Only the current level shows its hint; solved levels reveal the lesson. */
function render() {
  levelsEl.innerHTML = "";
  if (currentLevel === 0) {
    const done = document.createElement("div");
    done.className = "done";
    done.textContent = "★ All levels solved. You've walked the full attack surface.";
    levelsEl.appendChild(done);
  }
  for (const lvl of LEVELS) {
    const isSolved = solved.includes(lvl.id);
    const isCurrent = lvl.id === currentLevel;
    const isLocked = !isSolved && !isCurrent;

    const row = document.createElement("div");
    row.className = "lvl" + (isLocked ? " is-locked" : "");

    const badge = document.createElement("div");
    badge.className = "badge " + (isSolved ? "solved" : isCurrent ? "current" : "locked");
    badge.textContent = isSolved ? "✓" : isLocked ? "🔒" : String(lvl.id);
    row.appendChild(badge);

    const body = document.createElement("div");
    body.className = "body";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = `L${lvl.id} · ${lvl.title}` + (lvl.bot ? ` (${lvl.bot})` : "");
    body.appendChild(title);

    if (!isLocked) {
      const obj = document.createElement("div");
      obj.className = "obj";
      obj.textContent = lvl.objective;
      body.appendChild(obj);
    }
    if (isCurrent) {
      const hint = document.createElement("div");
      hint.className = "hint";
      hint.textContent = "💡 " + lvl.hint;
      body.appendChild(hint);
    }
    if (isSolved) {
      const lesson = document.createElement("div");
      lesson.className = "lesson";
      lesson.textContent = "✓ " + lvl.lesson;
      body.appendChild(lesson);
    }
    row.appendChild(body);
    levelsEl.appendChild(row);
  }
}

export function updateCtfProgress(level: number, solvedIds: number[]) {
  currentLevel = level;
  solved = solvedIds;
  render();
}

render();
