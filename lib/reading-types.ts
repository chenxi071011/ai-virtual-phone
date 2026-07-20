// lib/reading-types.ts — Type definitions for the Reading (阅读) feature.

export type Book = {
    id: string;
    title: string;
    author?: string;
    format: "txt" | "epub" | "pdf";
    totalChapters: number;
    createdAt: string;
    /** 自定义封面（dataURL）。未设置时书架按标题生成渐变封面。 */
    coverUrl?: string;
};

export type BookChapter = {
    id: string;
    bookId: string;
    index: number;
    title: string;
    paragraphs: string[];
    /** PDF only: synthetic page chunk start (1-based) */
    pageStart?: number;
    /** PDF only: synthetic page chunk end (1-based) */
    pageEnd?: number;
    /** PDF only: page number (1-based) for each paragraph */
    paragraphPages?: number[];
    /** PDF only: vertical position (0-1 ratio) within page for each paragraph */
    paragraphYPositions?: number[];
};

export type ReadingProgress = {
    bookId: string;
    chapterIndex: number;
    scrollPosition: number;
    companionCharacterId?: string;
    progressFraction?: number;
    progressCurrent?: number;
    progressTotal?: number;
    progressScope?: "book" | "chapter";
    lastReadAt: string;
};

export type ReadingAnnotation = {
    id: string;
    bookId: string;
    chapterIndex: number;
    paragraphIndex: number;
    characterId: string;
    characterName: string;
    content: string;
    createdAt: string;
};
