import type { ReactNode } from "react";
import type { RichDoc, RichNode } from "@beacon/shared";

/**
 * Draws a text block's formatted text. Every node becomes an element chosen
 * here, so nothing in the document is ever handed to the browser as HTML. The
 * hub has already dropped anything it does not know, and this skips it again.
 */
function marked(node: RichNode, key: string): ReactNode {
  let out: ReactNode = node.text ?? "";
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case "bold":
        out = <strong>{out}</strong>;
        break;
      case "italic":
        out = <em>{out}</em>;
        break;
      case "underline":
        out = <u>{out}</u>;
        break;
      case "strike":
        out = <s>{out}</s>;
        break;
      case "code":
        out = <code>{out}</code>;
        break;
      case "textStyle":
        if (mark.attrs?.color && /^#[0-9a-f]{6}$/i.test(mark.attrs.color)) out = <span style={{ color: mark.attrs.color }}>{out}</span>;
        break;
      case "link": {
        const href = mark.attrs?.href ?? "";
        if (/^(https?:\/\/|mailto:)/i.test(href)) {
          out = (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow">
              {out}
            </a>
          );
        }
        break;
      }
      default:
        break;
    }
  }
  return <span key={key}>{out}</span>;
}

function align(node: RichNode): React.CSSProperties | undefined {
  const value = node.attrs?.textAlign;
  return typeof value === "string" && ["left", "center", "right", "justify"].includes(value)
    ? { textAlign: value as React.CSSProperties["textAlign"] }
    : undefined;
}

function render(node: RichNode, key: string): ReactNode {
  const children = (node.content ?? []).map((child, index) => render(child, `${key}.${index}`));
  switch (node.type) {
    case "text":
      return marked(node, key);
    case "paragraph":
      return (
        <p key={key} style={align(node)}>
          {children.length > 0 ? children : <br />}
        </p>
      );
    case "heading": {
      const level = node.attrs?.level === 1 ? 1 : node.attrs?.level === 3 ? 3 : 2;
      const Tag = `h${level}` as "h1" | "h2" | "h3";
      return (
        <Tag key={key} style={align(node)}>
          {children}
        </Tag>
      );
    }
    case "bulletList":
      return <ul key={key}>{children}</ul>;
    case "orderedList":
      return (
        <ol key={key} start={typeof node.attrs?.start === "number" ? node.attrs.start : undefined}>
          {children}
        </ol>
      );
    case "listItem":
      return <li key={key}>{children}</li>;
    case "blockquote":
      return <blockquote key={key}>{children}</blockquote>;
    case "codeBlock":
      return (
        <pre key={key}>
          <code>{(node.content ?? []).map((child) => child.text ?? "").join("")}</code>
        </pre>
      );
    case "horizontalRule":
      return <hr key={key} />;
    case "hardBreak":
      return <br key={key} />;
    default:
      return null;
  }
}

export function RichDocView({ doc }: { doc: RichDoc }) {
  return <>{(doc.content ?? []).map((node, index) => render(node, String(index)))}</>;
}
