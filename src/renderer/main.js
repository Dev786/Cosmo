import { loadPack } from './packs/registry';
import { IPC } from '../shared/types';
async function init() {
    const container = document.getElementById('eyes-container');
    const chatArea = document.getElementById('chat-area');
    const chatMessages = document.getElementById('chat-messages');
    const chatInput = document.getElementById('chat-input');
    const chatSend = document.getElementById('chat-send');
    const micDot = document.getElementById('mic-dot');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Load classic pack
    const pack = await loadPack('classic', container, reducedMotion);
    let chatHideTimer = null;
    let captureMode = false;
    function showChat() {
        chatArea.classList.add('visible');
        if (chatHideTimer)
            clearTimeout(chatHideTimer);
        chatHideTimer = setTimeout(() => {
            if (!captureMode)
                chatArea.classList.remove('visible');
        }, 8000);
    }
    function appendMessage(text, type) {
        const msg = document.createElement('div');
        msg.className = `msg ${type}`;
        msg.textContent = text;
        chatMessages.appendChild(msg);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        showChat();
    }
    // ─── IPC listeners ───────────────────────────────────────────────────────
    window.cosmo.on(IPC.MOOD_SET, (_, data) => {
        const { state } = data;
        pack.setState(state);
    });
    window.cosmo.on(IPC.MOOD_PULSE, (_, data) => {
        const { event } = data;
        pack.pulse(event);
    });
    window.cosmo.on(IPC.MOOD_INTENSITY, (_, data) => {
        const { level } = data;
        pack.setIntensity(level);
    });
    window.cosmo.on(IPC.ACTIVITY_SET, (_, data) => {
        const { activity } = data;
        pack.setActivity(activity);
    });
    window.cosmo.on(IPC.CHAT_MESSAGE, (_, data) => {
        const { text, type } = data;
        appendMessage(text, type);
    });
    window.cosmo.on(IPC.VOICE_STATUS, (_, data) => {
        const { wakeFailed } = data;
        if (wakeFailed) {
            micDot.classList.add('always-visible');
        }
    });
    window.cosmo.on(IPC.CHAT_CAPTURE_MODE, (_, data) => {
        const { active } = data;
        captureMode = active;
        if (active) {
            chatArea.classList.add('visible', 'capture-mode');
            chatInput.focus();
            if (chatHideTimer)
                clearTimeout(chatHideTimer);
        }
        else {
            chatArea.classList.remove('capture-mode');
        }
    });
    // ─── Chat input ──────────────────────────────────────────────────────────
    async function submitChat() {
        const text = chatInput.value.trim();
        if (!text)
            return;
        chatInput.value = '';
        if (captureMode) {
            await window.cosmo.invoke(IPC.CHAT_SUBMIT, { text, captureOnly: true });
            captureMode = false;
            chatArea.classList.remove('capture-mode');
            window.cosmo.send('window:blur');
            return;
        }
        appendMessage(text, 'user');
        await window.cosmo.invoke(IPC.CHAT_SUBMIT, { text, captureOnly: false });
    }
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            submitChat();
        }
        if (e.key === 'Escape') {
            chatInput.value = '';
            captureMode = false;
            chatArea.classList.remove('visible', 'capture-mode');
        }
        // Any typing = interaction
        window.cosmo.send('user:interaction');
    });
    chatSend.addEventListener('click', submitChat);
    // ─── Mic dot ─────────────────────────────────────────────────────────────
    micDot.addEventListener('click', () => {
        window.cosmo.send(IPC.VOICE_TRIGGER);
    });
    // ─── Click on eyes = interaction ─────────────────────────────────────────
    container.addEventListener('click', () => {
        window.cosmo.send('user:interaction');
    });
    // ─── Error forwarding ────────────────────────────────────────────────────
    window.addEventListener('unhandledrejection', (e) => {
        window.cosmo.send(IPC.RENDERER_ERROR, { message: String(e.reason) });
    });
    window.addEventListener('error', (e) => {
        window.cosmo.send(IPC.RENDERER_ERROR, { message: e.message });
    });
}
init().catch(console.error);
//# sourceMappingURL=main.js.map