import type { Config } from '../../../shared/types';

export interface CalloutSet {
  idle: string[];
  distraction: string[];
  battery: string[];
  eyeStrain: string[];
  water: string[];
  return: string[];
}

const coach: CalloutSet = {
  idle: [
    "Hey, still there? Just checking in.",
    "You've been quiet for a while. Everything okay?",
    "Taking a mental break? That's fine, I'll be here.",
    "I've been staring at nothing for a while now.",
    "Still here whenever you're ready.",
    "No rush, but I'm ready when you are.",
    "Just checking — still alive out there?",
    "I assume you're thinking deeply. Very deeply.",
  ],
  distraction: [
    "Psst… still scrolling? Let's get back to it.",
    "That's been a while on there. Sprint's waiting.",
    "The video essays will still exist after your sprint.",
    "Just a gentle nudge back to the task at hand.",
    "The discourse will survive without you for a bit.",
  ],
  battery: [
    "Running low on power. You might want to plug in.",
    "Battery getting low — might be worth finding a charger.",
  ],
  eyeStrain: [
    "Look at something twenty feet away for twenty seconds.",
    "Give your eyes a quick break — look away from the screen.",
  ],
  water: [
    "Drink some water. You'll thank yourself later.",
    "Hydration check. When did you last have water?",
    "Quick water break — go.",
  ],
  return: [
    "Welcome back!",
    "Good to have you back.",
    "There you are!",
  ],
};

const drillSergeant: CalloutSet = {
  idle: [
    "STILL HERE. STILL WAITING. WHAT ARE WE DOING.",
    "Twenty-five minutes. I have been staring at nothing for twenty-five minutes.",
    "I assume you've been kidnapped. Blink twice.",
    "The work does not do itself.",
    "This is not a break. This is a disappearance.",
    "I'm not angry. I'm just disappointed. Actually I am angry.",
    "At what point does idle become permanently idle.",
    "Devashish. I am watching the clock.",
  ],
  distraction: [
    "Forty minutes of YouTube. The video essays will still exist after your sprint.",
    "Still on Twitter. The discourse will survive without you.",
    "That website is not your job. Your job is your job.",
    "You know what this is. We both know what this is.",
  ],
  battery: [
    "I'm running out of power. Unlike you, who has infinite energy for distractions.",
    "CRITICAL BATTERY. Also, get back to work.",
  ],
  eyeStrain: [
    "Look away from the screen. Twenty seconds. Do it.",
    "Eyes off the screen. Now. Twenty feet. Twenty seconds.",
  ],
  water: [
    "Drink water. Now.",
    "You're basically a houseplant. Water yourself.",
    "Water. Now. No excuses.",
  ],
  return: [
    "You're back. Interesting.",
    "Welcome back. I counted every minute.",
    "There you are. I've been watching the door.",
  ],
};

const therapist: CalloutSet = {
  idle: [
    "I notice you've been away for a while. How are you feeling?",
    "Sometimes stepping back is exactly what we need.",
    "I'm here when you're ready to engage again.",
    "It's okay to take breaks. How are you doing?",
    "I'm wondering what's on your mind right now.",
    "There's no judgment here — take the time you need.",
    "What would feel most supportive to you right now?",
    "I'm noticing a pause. Is everything okay?",
  ],
  distraction: [
    "I notice you've been spending time on something else. How does that feel?",
    "What is it about that site that feels appealing right now?",
    "Is there something about the current task that feels difficult?",
    "Sometimes avoidance is telling us something. What do you think?",
  ],
  battery: [
    "The battery needs attention. Perhaps a good moment to pause and recharge yourself too.",
    "Low battery — a gentle reminder to take care of the basics.",
  ],
  eyeStrain: [
    "Your eyes need a rest. Look at something far away for a moment.",
    "Give yourself a small gift — look away from the screen for twenty seconds.",
  ],
  water: [
    "Have you had water recently? Taking care of yourself matters.",
    "A gentle reminder to hydrate. You deserve to feel good.",
    "Water check — how's your body feeling right now?",
  ],
  return: [
    "Welcome back. I hope the break was restorative.",
    "Good to see you. How are you feeling?",
    "You're back. Take a breath and ease in.",
  ],
};

const silent: CalloutSet = {
  idle: [], distraction: [], battery: [], eyeStrain: [], water: [], return: [],
};

export function getCalloutSet(personality: Config['personality']): CalloutSet {
  switch (personality) {
    case 'coach': return coach;
    case 'drill-sergeant': return drillSergeant;
    case 'therapist': return therapist;
    case 'silent': return silent;
    default: return coach;
  }
}

export function pickCallout(arr: string[]): string {
  if (!arr.length) return '';
  return arr[Math.floor(Math.random() * arr.length)];
}
