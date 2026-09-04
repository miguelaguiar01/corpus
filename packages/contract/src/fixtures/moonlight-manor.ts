// Golden corpus/1 fixture (§15): exercises every metadata primitive,
// selects with per-branch examples, and refs with in-snapshot targets.
// Adapter, CLI, and server tests import this instead of inventing data.
import type { Snapshot } from "../snapshot";

export const moonlightManor = {
  contract: "corpus/1",
  project: "moonlight-manor",
  sourceLanguage: "pt-PT",
  stringTypes: {
    "clue-skin": {
      kind: {
        type: "enum",
        description: "What kind of clue this line delivers.",
        values: ["sighting", "gossip", "alibi"],
      },
      requires_trait: {
        type: "ref",
        description: "Trait the listener needs for this line to fire.",
        entityType: "trait",
      },
      mentions: {
        type: "list<ref>",
        description: "Characters this line talks about.",
        entityType: "character",
      },
      requires_windows: {
        type: "flag",
        description: "Only shown in rooms with windows.",
      },
      note: {
        type: "text",
        description: "Free-form guidance for the translator.",
      },
      slots: {
        type: "placeholders",
        description: "Slots the engine fills at render time.",
        slots: {
          person: { description: "Full name with article", role: "np-def" },
          person_gender: { description: "Gender key for selects" },
          room_de: {
            description: "Room with 'de' contraction baked in",
            role: "de-contraction",
          },
          hour: { description: "Time of the sighting, e.g. 21h" },
        },
      },
    },
    chrome: {
      note: { type: "text", description: "Context for UI strings." },
    },
  },
  entityTypes: {
    trait: { label: "Trait" },
    character: { label: "Character" },
    room: { label: "Room" },
  },
  strings: [
    {
      id: "skin.seen-at-greenhouse-window",
      type: "clue-skin",
      source:
        "{person} foi {person_gender, select, m {visto} f {vista}} à janela {room_de} às {hour} — e não estava {person_gender, select, m {sozinho} f {sozinha}}.",
      metadata: {
        kind: "sighting",
        requires_trait: "trait:insomnia",
        mentions: ["character:condessa-rosa", "character:doutor-vaz"],
        requires_windows: true,
        note: "Said by the butler; keep it dry.",
      },
      examples: [
        {
          values: {
            person: "a Condessa Rosa",
            person_gender: "f",
            room_de: "da estufa",
            hour: "21h",
          },
          rendered:
            "A Condessa Rosa foi vista à janela da estufa às 21h — e não estava sozinha.",
        },
        {
          values: {
            person: "o Doutor Vaz",
            person_gender: "m",
            room_de: "do salão",
            hour: "23h",
          },
          rendered:
            "O Doutor Vaz foi visto à janela do salão às 23h — e não estava sozinho.",
        },
      ],
    },
    {
      id: "skin.heard-nothing",
      type: "clue-skin",
      source: "Não ouvi nada a noite toda.",
      metadata: { kind: "alibi", note: "Deliberately flat delivery." },
    },
    {
      id: "ui.continue",
      type: "chrome",
      source: "Continuar",
      metadata: { note: "Button label at the end of a conversation." },
    },
  ],
  entities: [
    {
      id: "trait:insomnia",
      type: "trait",
      name: "Insónia",
      attributes: { summary: "This character wanders the manor at night." },
    },
    {
      id: "character:condessa-rosa",
      type: "character",
      name: "Condessa Rosa",
      attributes: { title: "Condessa", suspicious: "very" },
    },
    {
      id: "character:doutor-vaz",
      type: "character",
      name: "Doutor Vaz",
    },
    {
      id: "room:estufa",
      type: "room",
      name: "Estufa",
      attributes: { windows: "yes" },
    },
  ],
} satisfies Snapshot;
