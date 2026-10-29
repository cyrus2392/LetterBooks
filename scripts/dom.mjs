// Gives Node scripts the DOMParser that src/lib/wikipedia.js expects.
import { DOMParser } from 'linkedom';

globalThis.DOMParser = DOMParser;
