import { normalize } from './state-resolver';
import { classifyIntent, Intent } from './tourism-intent';
export function directItinerary(message: string): boolean {
  const text = normalize(message);
  return /\b(itinerarios?|recorridos?)\b/.test(text)
    || /\b(planea|planeame|organiza|organizame|prepara|preparame|arma|armame|hazme)\b.*\b(visita|plan)\b/.test(text);
}
const continuation = (message: string) => /^(y\b|uno\b|otro\b|otra\b)/.test(normalize(message));
/** Presentation and category memory are local and bounded; no transcript is sent to AI. */
export function itineraryContext(message: string, history: {role:string;content:string}[]): {itinerary:boolean; inheritedIntent?:Intent} {
  const users = history.slice(-12).filter(t=>t.role==='user').reverse();
  let itinerary = directItinerary(message);
  let inheritedIntent: Intent | undefined;
  if (itinerary || continuation(message)) {
    for (const user of users) {
      const intent = classifyIntent(user.content);
      if (!inheritedIntent && intent !== 'general') inheritedIntent = intent;
      if (directItinerary(user.content)) { itinerary = true; break; }
      if (!continuation(user.content)) break;
    }
  }
  return {itinerary, inheritedIntent};
}
