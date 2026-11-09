import { z } from "zod";
import { defineTool, type ChatTool } from "@/server/drivers/llm";
import { deleteNote, insertNote, noteById, notesForProject, updateNote } from "@/server/drivers/noteStore";
import { projectById } from "@/server/drivers/projectStore";
import type { ProjectNote } from "@/server/drivers/schema";
import { InputError } from "./errors";

// Project memory: answers the developer saved from the chat ("Save to
// memory"), given to later conversations so they start from what was
// already worked out. Only the developer writes notes; the chat reads them.
//
//   answer ──Save to memory──► project_notes ──► next chats' instructions
//                                              (newest first, within budget;
//                                               the rest by title + read_note)

const MAX_TITLE = 120;
const MAX_BODY = 20_000;

export type NoteView = Pick<ProjectNote, "id" | "title" | "body" | "updatedAt">;

const noteSchema = z.object({
  title: z.string().trim().min(1).max(MAX_TITLE),
  body: z.string().trim().min(1).max(MAX_BODY),
});

export function listNotes(projectId: number): NoteView[] {
  return notesForProject(projectId).map(view);
}

export function saveNote(projectId: number, input: { title: string; body: string }): NoteView {
  if (!projectById(projectId)) {
    throw new InputError("Unknown project");
  }

  const { title, body } = noteSchema.parse(input);
  return view(insertNote(projectId, title, body));
}

export function editNote(projectId: number, id: number, input: { title: string; body: string }): void {
  ownNote(projectId, id);
  const { title, body } = noteSchema.parse(input);
  updateNote(id, title, body);
}

export function removeNote(projectId: number, id: number): void {
  ownNote(projectId, id);
  deleteNote(id);
}

// The memory section of the chat's instructions, within `budget`
// characters: whole notes newest first, then the titles of the rest.
// "" without notes. `omitted`: whether some bodies were left out.
export function memoryContext(projectId: number, budget: number): { text: string; omitted: boolean } {
  const notes = notesForProject(projectId);
  const parts: string[] = [];
  const rest: ProjectNote[] = [];
  let used = 0;

  for (const n of notes) {
    const block = `### #${n.id} ${n.title}\n${n.body}`;
    if (rest.length === 0 && used + block.length <= budget) {
      parts.push(block);
      used += block.length;
      continue;
    }

    rest.push(n);
  }

  if (rest.length > 0) {
    parts.push(`Other notes (read_note to open): ${rest.map((n) => `#${n.id} ${n.title}`).join("; ")}`);
  }

  return { text: parts.join("\n\n"), omitted: rest.length > 0 };
}

// read_note, for notes the instructions list by title only.
export function noteTools(projectId: number): Record<string, ChatTool> {
  return {
    read_note: defineTool({
      description: "Read a project memory note listed by title, e.g. #12.",
      input: z.object({ id: z.number().int().describe("Note number, e.g. 12 for #12") }),
      run: async ({ id }) => {
        const note = noteById(id);
        return note && note.projectId === projectId ? `# ${note.title}\n${note.body}` : `Error: no note #${id}.`;
      },
    }),
  };
}

// The note, if it belongs to the project. Ids come from the browser.
function ownNote(projectId: number, id: number): ProjectNote {
  const note = noteById(id);
  if (!note || note.projectId !== projectId) {
    throw new InputError("Unknown note");
  }

  return note;
}

function view({ id, title, body, updatedAt }: ProjectNote): NoteView {
  return { id, title, body, updatedAt };
}
