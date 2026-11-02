const apiUrl = "/api/timestamps";
const oneHourInMilliseconds = 60 * 60 * 1000;

const taskDefinitions = {
    "laundry": {
        label: "Laundry",
        noun: "laundry",
        targetHours: 40,
        recordButtonLabel: "Record 洗衣服",
        recordFallback: "Laundry recorded successfully.",
    },
    "guinea-pigs": {
        label: "Guinea pig cleaning",
        noun: "guinea pig cleaning",
        targetHours: 70,
        recordButtonLabel: "Record 打扫猪猪",
        recordFallback: "Guinea pig cleaning recorded successfully.",
    },
    "hang-clothes": {
        label: "Hanging clothes",
        noun: "hanging clothes",
        targetHours: 45,
        recordButtonLabel: "Record 晾衣服",
        recordFallback: "Hanging clothes recorded successfully.",
    },
    "kaka-teeth": {
        label: "Kaka teeth brushing",
        noun: "Kaka teeth brushing",
        targetHours: 100,
        recordButtonLabel: "Record Kaka 刷牙",
        recordFallback: "Kaka teeth brushing recorded successfully.",
    },
};

const taskControllers = Array.from(document.querySelectorAll("[data-task]")).map((panel) => {
    const task = panel.dataset.task;
    return {
        task,
        definition: taskDefinitions[task],
        recordButton: panel.querySelector('[data-action="record"]'),
        refreshButton: panel.querySelector('[data-action="refresh"]'),
        message: panel.querySelector('[data-role="message"]'),
        statusCard: panel.querySelector('[data-role="status"]'),
        emptyMessage: panel.querySelector('[data-role="empty"]'),
        timestampList: panel.querySelector('[data-role="history"]'),
    };
});

taskControllers.forEach((controller) => {
    controller.recordButton.addEventListener("click", () => recordTask(controller));
    controller.refreshButton.addEventListener("click", () => loadTimestamps(controller));
    loadTimestamps(controller);
});

async function recordTask(controller) {
    setBusy(controller, true);
    showMessage(controller, "Recording…");
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 10000);

    try {
        const response = await fetch(apiUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ task: controller.task }),
            signal: abortController.signal,
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.message || `The server could not record ${controller.definition.noun}.`);
        }

        const serverMessage = result.message || controller.definition.recordFallback;
        const recordedAt = result.timestamp ? ` Recorded at ${formatTimestamp(result.timestamp)}.` : "";
        showMessage(controller, `${serverMessage}${recordedAt}`, "success");
        await loadTimestamps(controller, false);
    } catch (error) {
        const errorMessage = error.name === "AbortError"
            ? "Recording took longer than 10 seconds. Refresh the history before trying again."
            : error.message || "Something went wrong. Please try again.";
        showMessage(controller, errorMessage, "error");
    } finally {
        clearTimeout(timeout);
        setBusy(controller, false);
    }
}

async function loadTimestamps(controller, showLoadingMessage = true) {
    controller.refreshButton.disabled = true;
    if (showLoadingMessage) {
        showMessage(controller, "Loading history…");
    }

    try {
        const url = `${apiUrl}?task=${encodeURIComponent(controller.task)}`;
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`The server could not load the ${controller.definition.noun} history.`);
        }

        const result = await response.json();
        const records = Array.isArray(result.records)
            ? result.records
            : (result.timestamps || []).map((timestamp) => ({ id: timestamp, timestamp }));
        renderTimestamps(controller, records);
        renderStatus(controller, records[0]?.timestamp);
        if (showLoadingMessage) showMessage(controller, "");
    } catch (error) {
        showMessage(controller, error.message || "Something went wrong. Please try again.", "error");
        controller.statusCard.className = "status-card empty";
        controller.statusCard.textContent = "Status unavailable.";
    } finally {
        controller.refreshButton.disabled = false;
    }
}

function renderTimestamps(controller, records) {
    controller.timestampList.replaceChildren();
    controller.emptyMessage.hidden = records.length !== 0;

    records.forEach((record) => {
        const timestamp = record.timestamp;
        const date = new Date(timestamp);
        const item = document.createElement("li");
        const content = document.createElement("div");
        const time = document.createElement("time");
        const relative = document.createElement("small");

        time.dateTime = timestamp;
        time.textContent = formatTimestamp(timestamp);
        relative.textContent = formatRelative(date);
        content.append(time, relative);

        item.append(content);
        if (Date.now() - date.getTime() < oneHourInMilliseconds) {
            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.className = "dl-button dl-button-small dl-button-danger delete-button";
            deleteButton.textContent = "Delete";
            deleteButton.setAttribute(
                "aria-label",
                `Delete ${controller.definition.noun} record from ${formatTimestamp(timestamp)}`,
            );
            deleteButton.addEventListener("click", () => deleteRecord(controller, record, deleteButton));
            item.append(deleteButton);
        }
        controller.timestampList.append(item);
    });
}

async function deleteRecord(controller, record, button) {
    const confirmed = window.confirm(
        `Delete the ${controller.definition.noun} record from ${formatTimestamp(record.timestamp)}? This cannot be undone.`,
    );
    if (!confirmed) return;

    button.disabled = true;
    button.textContent = "Deleting…";
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 10000);

    try {
        const response = await fetch(apiUrl, {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ task: controller.task, id: record.id }),
            signal: abortController.signal,
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.message || `The server could not delete the ${controller.definition.noun} record.`);
        }

        showMessage(controller, result.message || "Record deleted successfully.", "success");
        await loadTimestamps(controller, false);
    } catch (error) {
        const errorMessage = error.name === "AbortError"
            ? "Deletion took longer than 10 seconds. Refresh the history before trying again."
            : error.message || "Something went wrong. Please try again.";
        showMessage(controller, errorMessage, "error");
        button.disabled = false;
        button.textContent = "Delete";
    } finally {
        clearTimeout(timeout);
    }
}

function renderStatus(controller, latestTimestamp) {
    const { statusCard, definition } = controller;
    if (!latestTimestamp) {
        statusCard.className = "status-card empty";
        statusCard.textContent = `No ${definition.noun} has been recorded yet.`;
        return;
    }

    const latest = new Date(latestTimestamp);
    const targetDuration = definition.targetHours * oneHourInMilliseconds;
    const deadline = new Date(latest.getTime() + targetDuration);
    const remaining = deadline.getTime() - Date.now();
    const title = document.createElement("strong");
    const detail = document.createElement("span");

    statusCard.replaceChildren();
    if (remaining >= 0) {
        statusCard.className = "status-card good";
        title.textContent = `On track — ${formatDuration(remaining)} remaining`;
        detail.textContent = `Next ${definition.noun} should be recorded by ${formatTimestamp(deadline.toISOString())}.`;
    } else {
        statusCard.className = "status-card overdue";
        title.textContent = `Overdue by ${formatDuration(Math.abs(remaining))}`;
        detail.textContent = `The last ${definition.noun} was recorded ${formatTimestamp(latestTimestamp)}.`;
    }
    statusCard.append(title, detail);
}

function formatTimestamp(timestamp) {
    return new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
    }).format(new Date(timestamp));
}

function formatRelative(date) {
    const difference = date.getTime() - Date.now();
    const absoluteMinutes = Math.round(Math.abs(difference) / 60000);
    if (absoluteMinutes < 1) return "just now";
    if (absoluteMinutes < 60) return `${absoluteMinutes} minute${absoluteMinutes === 1 ? "" : "s"} ago`;
    const hours = Math.round(absoluteMinutes / 60);
    if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    const days = Math.round(hours / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
}

function formatDuration(milliseconds) {
    const totalMinutes = Math.max(0, Math.ceil(milliseconds / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return `${minutes}m`;
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

function setBusy(controller, busy) {
    controller.recordButton.disabled = busy;
    controller.recordButton.textContent = busy ? "Recording…" : controller.definition.recordButtonLabel;
}

function showMessage(controller, text, type = "") {
    controller.message.textContent = text;
    controller.message.className = type ? `message dl-${type}` : "message";
}

setInterval(() => {
    taskControllers.forEach((controller) => loadTimestamps(controller, false));
}, 60000);
