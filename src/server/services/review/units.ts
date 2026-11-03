import type { ReviewUnit } from "@/server/drivers/schema";

// A unit covers one file chunk, or a group of related files reviewed
// together. Both shapes decode to the same view:
//
//   single:  fileId 4, fileIds null,    hunks [0,1]            → { 4: [0,1] }
//   grouped: fileId 4, fileIds [4,9],   hunks {"4":[0],"9":[0]} → { 4: [0], 9: [0] }

type UnitFiles = Pick<ReviewUnit, "fileId" | "fileIds" | "hunks">;

export function unitFileIds(u: Pick<ReviewUnit, "fileId" | "fileIds">): number[] {
  return u.fileIds ? (JSON.parse(u.fileIds) as number[]) : [u.fileId];
}

// Hunk indexes per file id.
export function unitHunks(u: UnitFiles): Map<number, number[]> {
  const parsed = JSON.parse(u.hunks) as number[] | Record<string, number[]>;
  if (Array.isArray(parsed)) {
    return new Map([[u.fileId, parsed]]);
  }

  return new Map(Object.entries(parsed).map(([id, hunks]) => [Number(id), hunks]));
}
