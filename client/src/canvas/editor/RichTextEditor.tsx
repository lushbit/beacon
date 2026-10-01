import { useEffect, useState, type ReactNode } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import { Placeholder } from "@tiptap/extensions";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Palette,
  Quote,
  RemoveFormatting,
  Strikethrough,
  Underline,
} from "lucide-react";
import type { RichDoc } from "@beacon/shared";
import { sanitizeRichDoc } from "@beacon/shared";
import { ColorPicker } from "@/components/ColorPicker";
import { cn } from "@/lib/utils";

/**
 * Turns the plain text an older text block holds into a document, so it opens
 * in the editor looking the way it did. The marks it understood (bold, italics,
 * code and links) come across as formatting.
 */
export function textToDoc(text: string): RichDoc {
  const inline = (line: string) => {
    const nodes: RichDoc["content"] = [];
    const pattern = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g;
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line))) {
      if (match.index > last) nodes.push({ type: "text", text: line.slice(last, match.index) });
      if (match[2] !== undefined) nodes.push({ type: "text", text: match[2], marks: [{ type: "bold" }] });
      else if (match[3] !== undefined) nodes.push({ type: "text", text: match[3], marks: [{ type: "italic" }] });
      else if (match[4] !== undefined) nodes.push({ type: "text", text: match[4], marks: [{ type: "code" }] });
      else nodes.push({ type: "text", text: match[5], marks: [{ type: "link", attrs: { href: match[6] } }] });
      last = match.index + match[0].length;
    }
    if (last < line.length) nodes.push({ type: "text", text: line.slice(last) });
    return nodes;
  };
  const content: RichDoc["content"] = [];
  for (const chunk of text.replace(/\r\n/g, "\n").split(/\n{2,}/)) {
    const lines = chunk.split("\n").filter((line) => line.trim() !== "");
    if (lines.length === 0) continue;
    if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
      content.push({
        type: "bulletList",
        content: lines.map((line) => ({ type: "listItem", content: [{ type: "paragraph", content: inline(line.replace(/^\s*[-*]\s+/, "")) }] })),
      });
    } else {
      const parts: NonNullable<RichDoc["content"]> = [];
      lines.forEach((line, index) => {
        if (index > 0) parts.push({ type: "hardBreak" });
        parts.push(...(inline(line) ?? []));
      });
      content.push({ type: "paragraph", content: parts });
    }
  }
  return { type: "doc", content };
}

function ToolButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      // Keeps the text selected while a button is pressed.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground",
        active && "bg-surface-3 text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const [colorOpen, setColorOpen] = useState(false);
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      underline: current.isActive("underline"),
      strike: current.isActive("strike"),
      code: current.isActive("code"),
      h1: current.isActive("heading", { level: 1 }),
      h2: current.isActive("heading", { level: 2 }),
      h3: current.isActive("heading", { level: 3 }),
      bullet: current.isActive("bulletList"),
      ordered: current.isActive("orderedList"),
      quote: current.isActive("blockquote"),
      link: current.isActive("link"),
      left: current.isActive({ textAlign: "left" }),
      center: current.isActive({ textAlign: "center" }),
      right: current.isActive({ textAlign: "right" }),
      color: (current.getAttributes("textStyle").color as string | undefined) ?? "",
    }),
  });
  const chain = () => editor.chain().focus();

  const setLink = () => {
    const current = (editor.getAttributes("link").href as string | undefined) ?? "https://";
    const href = window.prompt("Link address", current);
    if (href === null) return;
    if (href.trim() === "" || href.trim() === "https://") {
      chain().extendMarkRange("link").unsetLink().run();
      return;
    }
    if (!/^(https?:\/\/|mailto:)/i.test(href.trim())) {
      window.alert("Links have to start with https://, http:// or mailto:");
      return;
    }
    chain().extendMarkRange("link").setLink({ href: href.trim() }).run();
  };

  return (
    <div className="border-b border-border/60">
      <div className="flex flex-wrap items-center gap-0.5 p-1">
        <ToolButton label="Bold" active={state.bold} onClick={() => chain().toggleBold().run()}>
          <Bold className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label="Italic" active={state.italic} onClick={() => chain().toggleItalic().run()}>
          <Italic className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label="Underline" active={state.underline} onClick={() => chain().toggleUnderline().run()}>
          <Underline className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label="Strikethrough" active={state.strike} onClick={() => chain().toggleStrike().run()}>
          <Strikethrough className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label="Code" active={state.code} onClick={() => chain().toggleCode().run()}>
          <Code className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label="Link" active={state.link} onClick={setLink}>
          <Link2 className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label="Text colour" active={colorOpen || state.color !== ""} onClick={() => setColorOpen(!colorOpen)}>
          <Palette className="h-3.5 w-3.5" style={state.color ? { color: state.color } : undefined} />
        </ToolButton>
        <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
        <ToolButton label="Large heading" active={state.h1} onClick={() => chain().toggleHeading({ level: 1 }).run()}>
          <Heading1 className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label="Heading" active={state.h2} onClick={() => chain().toggleHeading({ level: 2 }).run()}>
          <Heading2 className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label="Small heading" active={state.h3} onClick={() => chain().toggleHeading({ level: 3 }).run()}>
          <Heading3 className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label="Bulleted list" active={state.bullet} onClick={() => chain().toggleBulletList().run()}>
          <List className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label="Numbered list" active={state.ordered} onClick={() => chain().toggleOrderedList().run()}>
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label="Quote" active={state.quote} onClick={() => chain().toggleBlockquote().run()}>
          <Quote className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label="Line" onClick={() => chain().setHorizontalRule().run()}>
          <Minus className="h-3.5 w-3.5" />
        </ToolButton>
        <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
        <ToolButton label="Align left" active={state.left} onClick={() => chain().setTextAlign("left").run()}>
          <AlignLeft className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label="Centre" active={state.center} onClick={() => chain().setTextAlign("center").run()}>
          <AlignCenter className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label="Align right" active={state.right} onClick={() => chain().setTextAlign("right").run()}>
          <AlignRight className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label="Clear formatting" onClick={() => chain().unsetAllMarks().clearNodes().run()}>
          <RemoveFormatting className="h-3.5 w-3.5" />
        </ToolButton>
      </div>
      {colorOpen ? (
        <div className="border-t border-border/60 p-3">
          <ColorPicker
            value={state.color}
            onChange={(color) => (color ? chain().setColor(color).run() : chain().unsetColor().run())}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The text block's editor: what is typed here looks the way it will on the
 * page. Every change is handed back cleaned, the same way the hub cleans it.
 */
export function RichTextEditor({
  doc,
  text,
  onChange,
}: {
  doc: RichDoc | null | undefined;
  text: string;
  onChange: (doc: RichDoc, text: string) => void;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false, autolink: true, protocols: ["https", "http", "mailto"] },
        codeBlock: false,
      }),
      TextStyle,
      Color,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({ placeholder: "Write something…" }),
    ],
    content: doc ?? textToDoc(text),
    editorProps: {
      attributes: { class: "canvas-rich min-h-[9rem] px-3 py-2.5 text-sm focus:outline-none", "aria-label": "Text" },
    },
    onUpdate: ({ editor: current }) => {
      const clean = sanitizeRichDoc(current.getJSON());
      if (clean) onChange(clean, current.getText({ blockSeparator: "\n\n" }).slice(0, 4000));
    },
  });

  // A different block was picked while this editor stayed on screen.
  useEffect(() => {
    if (!editor) return;
    const next = doc ?? textToDoc(text);
    if (JSON.stringify(sanitizeRichDoc(editor.getJSON())) !== JSON.stringify(sanitizeRichDoc(next))) {
      editor.commands.setContent(next, { emitUpdate: false });
    }
    // Only when the content arrives from outside, such as an undo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, doc]);

  if (!editor) return null;
  return (
    <div className="overflow-hidden rounded-md border border-input bg-surface-2 focus-within:border-primary/60">
      <Toolbar editor={editor} />
      <div className="scroll-slim max-h-80 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
