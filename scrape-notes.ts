import cuid from "cuid";
import { fetchWithHeaders } from "./utils";
import { db, db as knex } from "./db";

/**
 * Interfaces for Substack note comments
 */
interface SubstackNoteComment {
  comment?: {
    id: string;
    body: string;
    body_json: any;
    date: string;
    handle: string;
    name: string;
    photo_url: string;
    reaction_count: number;
    restacks: number;
    attachments?: Attachment[];
    user_id: string;
    userId: string;
    restacked: boolean;
    reactions: any;
    children_count: number;
  };
  isRestacked: boolean;
  entity_key: string;
  type: string;
  contextType: string;
  timestamp: string;
  context?: {
    type: string;
    timestamp: string;
  };
}

interface Attachment {
  id: string;
  type: string;
  imageUrl: string;
}

interface DbNote {
  id: string;
  entity_key: string;
  type: string;
  timestamp: string;
  context_type: string;
  is_restacked: boolean;
}

interface DbComment {
  id: string;
  comment_id: string;
  type: string;
  user_id: string;
  body: string;
  body_json: any;
  date: string;
  handle: string;
  name: string;
  photo_url: string;
  reaction_count: number;
  restacks: number;
  restacked: boolean;
  timestamp: string;
  context_type: string;
  entity_key: string;
  note_is_restacked: boolean;
  reactions: any;
  children_count: number;
}

interface DbAttachment {
  id: string;
  comment_id: string;
  attachment_id: string;
  type: string;
  image_url: string;
}

interface DbNoteComment {
  note: DbNote;
  comment: DbComment | null;
  attachments: DbAttachment[];
}

interface ApiResponse {
  items?: Array<{
    type: string;
    entity_key: string;
    comment?: any;
    context: {
      type: string;
      timestamp: string;
    };
  }>;
  nextCursor?: string;
}

/**
 * Converts a Substack note comment to database format
 */
function convertSubstackNoteCommentToDB(
  noteComment: SubstackNoteComment
): DbNoteComment {
  // Extract note data
  const note: DbNote = {
    id: cuid(),
    entity_key: noteComment.entity_key,
    type: noteComment.type,
    timestamp: noteComment.timestamp, // Assumes ISO string compatible with TIMESTAMP
    context_type: noteComment.contextType,
    is_restacked: noteComment.isRestacked,
  };

  // Extract comment data (if present)
  let comment: DbComment | null = null;
  if (noteComment.comment) {
    comment = {
      id: cuid(),
      comment_id: noteComment.comment.id,
      type: noteComment.type, // Reusing note's type, adjust if different logic needed
      user_id: noteComment.comment.userId,
      body: noteComment.comment.body,
      body_json: noteComment.comment.body_json,
      date: noteComment.comment.date, // Assumes ISO string compatible with TIMESTAMP
      handle: noteComment.comment.handle,
      name: noteComment.comment.name,
      photo_url: noteComment.comment.photo_url,
      reaction_count: noteComment.comment.reaction_count,
      restacks: noteComment.comment.restacks,
      restacked: noteComment.comment.restacked,
      timestamp: noteComment.timestamp,
      context_type: noteComment.contextType,
      entity_key: noteComment.entity_key,
      note_is_restacked: noteComment.isRestacked,
      reactions: noteComment.comment.reactions, // Array of objects string to number. In postgres,
      children_count: noteComment.comment.children_count,
    };
  }

  // Extract attachments (empty array if no comment or no attachments)
  const attachments: DbAttachment[] =
    noteComment.comment?.attachments?.map((attachment) => ({
      id: attachment.id, // Using attachment.id as the PRIMARY KEY
      comment_id: noteComment.comment!.id, // Safe since we're in the map after checking comment
      attachment_id: attachment.id, // Storing id again, adjust if a different identifier is needed
      type: attachment.type,
      image_url: attachment.imageUrl,
    })) || [];

  return { note, comment, attachments };
}

async function fetchAllNoteComments(authorId: string): Promise<number> {
  const maxNotes = 99999;
  const marginOfSafety = 10;
  let currentNoNewNotesCount = 0;
  const allUserNotes = await db("notes_comments").where("user_id", authorId);
  const allUserNotesBody = allUserNotes.map((note) => note.body);
  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

  const collectedComments: SubstackNoteComment[] = [];
  const initialUrl = `https://substack.com/api/v1/reader/feed/profile/${authorId}`;
  let nextUrl: string | null = initialUrl;
  let prevUrl = "";
  const maxEmptyPages = 10;
  let emptyPages = 0;

  while (nextUrl) {
    if (nextUrl === prevUrl) {
      nextUrl = null;
      continue;
    }
    prevUrl = nextUrl;

    const data: ApiResponse | null = await fetchWithHeaders(nextUrl);

    if (!data) {
      console.log(`No response for ${nextUrl}`);
      nextUrl = null;
      continue;
    }

    if (!data.items || data.items.length === 0) {
      if (data.nextCursor !== "" && !data.nextCursor) {
        break;
      }
      emptyPages++;
      if (emptyPages >= maxEmptyPages || !data.nextCursor) {
        nextUrl = null;
      }
      nextUrl = `${initialUrl}?cursor=${data.nextCursor}`;
      continue;
    }

    emptyPages = 0;
    const noteItems = data.items;
    const comments = noteItems.filter((it) => it.type === "comment");

    if (comments.length === 0) {
      if (data.nextCursor !== "" && !data.nextCursor) {
        break;
      }
      emptyPages++;
      console.log(`No comments for ${emptyPages} tries`);
      if (emptyPages >= maxEmptyPages) {
        nextUrl = null;
      }
      nextUrl = `${initialUrl}?cursor=${data.nextCursor}`;
      continue;
    }

    for (const item of comments) {
      const { comment } = item;
      collectedComments.push({
        comment: {
          id: comment.id,
          body: comment.body,
          body_json: comment.body_json,
          date: comment.date,
          handle: comment.handle,
          name: comment.name,
          photo_url: comment.photo_url,
          reaction_count: comment.reaction_count,
          restacks: comment.restacks,
          attachments: comment.attachments,
          userId: authorId,
          user_id: comment.user_id,
          restacked: comment.restacked,
          reactions: comment.reactions,
          children_count: comment.children_count,
        },
        isRestacked: item.context.type === "comment_restack",
        entity_key: item.entity_key,
        type: item.type,
        contextType: item.context.type,
        timestamp: item.context.timestamp,
      });
    }

    // All comments that are not in the user's notes or that are younger than 2 week
    const newComments = comments.filter(
      (comment) => !allUserNotesBody.includes(comment.comment?.body)
    );

    const commentsLessThanTwoWeeks = comments.filter(
      (comment) => new Date(comment.comment?.date) >= twoWeeksAgo
    );

    const allNewComments = [...newComments, ...commentsLessThanTwoWeeks];
    // Remove duplicates
    const uniqueComments = allNewComments.filter(
      (comment, index, self) =>
        index ===
        self.findIndex((t) => t.comment?.body === comment.comment?.body)
    );

    if (collectedComments.length >= maxNotes) {
      break;
    }

    if (uniqueComments.length === 0) {
      currentNoNewNotesCount++;
      console.log(`No new notes for ${currentNoNewNotesCount} tries`);
      if (currentNoNewNotesCount >= marginOfSafety) {
        break;
      }
    } else {
      currentNoNewNotesCount = 0;
      console.log(`New notes found, resetting counter`);
    }

    console.log(`Fetched ${collectedComments.length} notes out of ${maxNotes}`);
    nextUrl = `${initialUrl}?cursor=${data.nextCursor}`;
  }

  console.log("Collected comments", collectedComments.length);

  const dbNotes: DbNoteComment[] = collectedComments.map((note) =>
    convertSubstackNoteCommentToDB(note)
  );

  // const notes = dbNotes.map((note) => note.note);
  // Insert only those that are older than 2 weeks to make sure we don't insert popular notes that were just posted.

  const commentsDB = dbNotes
    .map((note) => note.comment)
    .filter((comment): comment is DbComment => comment !== null);

  const attachments = dbNotes.flatMap((note) => note.attachments);

  if (commentsDB.length > 0) {
    const uniqueComments = Array.from(
      new Map(
        commentsDB.map((c) => [`${c.comment_id}-${c.user_id}`, c])
      ).values()
    );
    console.log("About to insert", uniqueComments.length);
    const result: any = await knex("notes_comments")
      .insert(uniqueComments)
      .onConflict(["comment_id", "user_id"])
      .merge([
        "reactions",
        "children_count",
        "restacks",
        "reaction_count",
        "body",
        "body_json",
        "date",
        "handle",
        "name",
        "photo_url",
        "timestamp",
        "context_type",
        "entity_key",
        "note_is_restacked",
      ]);
    console.log("Inserted", result.rowCount, "Notes");
  }
  if (attachments.length > 0) {
    console.log("About to insert attachments", attachments.length);
    const result: any = await knex("comment_attachments")
      .insert(attachments)
      .onConflict("id")
      .ignore();
    console.log("Inserted", result.rowCount, "Attachments");
  }

  console.log("Inserted comments", commentsDB.length);
  return dbNotes.length;
}

export { fetchAllNoteComments, convertSubstackNoteCommentToDB };
