import React from 'react'

type MarkdownViewProps = {
  content: string
  onPlaceClick?: (placeName: string) => void
}

function renderFormattedSpan(text: string, keyPrefix: string, onPlaceClick?: (placeName: string) => void): React.ReactNode {
  // Regex to match **bold**, *italic*, `code`, and place tags [📍 Place]
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[📍\s*([^\]]+)\])/g
  const parts = text.split(regex)

  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`
    if (!part) return null

    if (part.startsWith('**') && part.endsWith('**')) {
      const inner = part.slice(2, -2)
      return (
        <strong key={key} className="md-bold">
          {inner}
        </strong>
      )
    }

    if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**')) {
      return (
        <em key={key} className="md-italic">
          {part.slice(1, -1)}
        </em>
      )
    }

    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={key} className="md-code">
          {part.slice(1, -1)}
        </code>
      )
    }

    if (part.startsWith('[📍') && part.endsWith(']')) {
      const place = part.replace(/^\[📍\s*/, '').replace(/\]$/, '').trim()
      return (
        <button
          key={key}
          type="button"
          className="md-place-tag"
          onClick={() => onPlaceClick?.(place)}
          title={`Show ${place} on map`}
        >
          📍 {place}
        </button>
      )
    }

    return <span key={key}>{part}</span>
  })
}

export function MarkdownView({ content, onPlaceClick }: MarkdownViewProps) {
  if (!content) return null

  const lines = content.split('\n')
  const elements: React.ReactNode[] = []
  let listItems: React.ReactNode[] = []
  let inList = false
  let listType: 'ul' | 'ol' = 'ul'

  function flushList() {
    if (inList && listItems.length > 0) {
      if (listType === 'ol') {
        elements.push(
          <ol key={`list-${elements.length}`} className="md-ol">
            {listItems}
          </ol>,
        )
      } else {
        elements.push(
          <ul key={`list-${elements.length}`} className="md-ul">
            {listItems}
          </ul>,
        )
      }
      listItems = []
      inList = false
    }
  }

  lines.forEach((line, lineIndex) => {
    const trimmed = line.trim()

    // Empty line
    if (!trimmed) {
      flushList()
      return
    }

    // Headers
    if (trimmed.startsWith('### ')) {
      flushList()
      elements.push(
        <h4 key={`h3-${lineIndex}`} className="md-h3">
          {renderFormattedSpan(trimmed.slice(4), `h3-${lineIndex}`, onPlaceClick)}
        </h4>,
      )
      return
    }

    if (trimmed.startsWith('## ')) {
      flushList()
      elements.push(
        <h3 key={`h2-${lineIndex}`} className="md-h2">
          {renderFormattedSpan(trimmed.slice(3), `h2-${lineIndex}`, onPlaceClick)}
        </h3>,
      )
      return
    }

    if (trimmed.startsWith('# ')) {
      flushList()
      elements.push(
        <h2 key={`h1-${lineIndex}`} className="md-h1">
          {renderFormattedSpan(trimmed.slice(2), `h1-${lineIndex}`, onPlaceClick)}
        </h2>,
      )
      return
    }

    // Blockquote
    if (trimmed.startsWith('> ')) {
      flushList()
      elements.push(
        <blockquote key={`quote-${lineIndex}`} className="md-blockquote">
          {renderFormattedSpan(trimmed.slice(2), `q-${lineIndex}`, onPlaceClick)}
        </blockquote>,
      )
      return
    }

    // Numbered list: "1. ", "2. "
    const numMatch = trimmed.match(/^(\d+)\.\s+(.+)$/)
    if (numMatch) {
      if (!inList || listType !== 'ol') {
        flushList()
        inList = true
        listType = 'ol'
      }
      listItems.push(
        <li key={`ol-item-${lineIndex}`} className="md-li">
          {renderFormattedSpan(numMatch[2], `ol-text-${lineIndex}`, onPlaceClick)}
        </li>,
      )
      return
    }

    // Bullet list: "• ", "- ", "* "
    const bulletMatch = trimmed.match(/^(?:•|-|\*)\s+(.+)$/)
    if (bulletMatch) {
      if (!inList || listType !== 'ul') {
        flushList()
        inList = true
        listType = 'ul'
      }
      listItems.push(
        <li key={`ul-item-${lineIndex}`} className="md-li">
          {renderFormattedSpan(bulletMatch[1], `ul-text-${lineIndex}`, onPlaceClick)}
        </li>,
      )
      return
    }

    // Normal paragraph
    flushList()
    elements.push(
      <p key={`p-${lineIndex}`} className="md-p">
        {renderFormattedSpan(trimmed, `p-text-${lineIndex}`, onPlaceClick)}
      </p>,
    )
  })

  flushList()

  return <div className="markdown-body">{elements}</div>
}
