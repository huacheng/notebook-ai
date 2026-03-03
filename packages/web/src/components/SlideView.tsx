import { useState, useCallback } from 'react';
import { useStore } from '../store';
import type { SlideSection } from '@notebook-ai/shared';

// ── Section card ─────────────────────────────────────────────────────────────

function SlideSectionCard({
  section,
  onUpdate,
  onDelete,
  onMove,
  isFirst,
  isLast,
}: {
  section: SlideSection;
  onUpdate: (id: string, patch: Partial<Pick<SlideSection, 'title' | 'content'>>) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingContent, setEditingContent] = useState(false);
  const [draftTitle, setDraftTitle] = useState(section.title);
  const [draftContent, setDraftContent] = useState(section.content);

  function commitTitle() {
    const trimmed = draftTitle.trim() || section.title;
    onUpdate(section.id, { title: trimmed });
    setEditingTitle(false);
  }

  function commitContent() {
    onUpdate(section.id, { content: draftContent });
    setEditingContent(false);
  }

  return (
    <div className="slide-section">
      {/* Header bar with order, move, and delete controls */}
      <div className="slide-section-header">
        <span className="slide-section-order">#{section.order + 1}</span>

        <div className="slide-section-actions">
          <button
            className="cell-btn"
            onClick={() => onMove(section.id, 'up')}
            disabled={isFirst}
            title="Move up"
          >
            &#9650;
          </button>
          <button
            className="cell-btn"
            onClick={() => onMove(section.id, 'down')}
            disabled={isLast}
            title="Move down"
          >
            &#9660;
          </button>
          <button
            className="cell-btn cell-btn-delete"
            onClick={() => onDelete(section.id)}
            title="Delete section"
          >
            &#10005;
          </button>
        </div>
      </div>

      {/* Editable title */}
      {editingTitle ? (
        <input
          className="slide-title-input"
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitTitle();
            if (e.key === 'Escape') {
              setDraftTitle(section.title);
              setEditingTitle(false);
            }
          }}
          autoFocus
        />
      ) : (
        <h3
          className="slide-section-title"
          onClick={() => {
            setDraftTitle(section.title);
            setEditingTitle(true);
          }}
          title="Click to edit title"
        >
          {section.title}
        </h3>
      )}

      {/* Editable content */}
      {editingContent ? (
        <div className="slide-content-edit-wrapper">
          <textarea
            className="slide-content-textarea"
            value={draftContent}
            onChange={(e) => setDraftContent(e.target.value)}
            onBlur={commitContent}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setDraftContent(section.content);
                setEditingContent(false);
              }
            }}
            autoFocus
            rows={6}
          />
          <button className="slide-content-done-btn" onClick={commitContent}>
            Done
          </button>
        </div>
      ) : (
        <div
          className="slide-section-content"
          onClick={() => {
            setDraftContent(section.content);
            setEditingContent(true);
          }}
          title="Click to edit content"
        >
          {section.content}
        </div>
      )}

      {/* Cell references */}
      {section.cell_refs.length > 0 && (
        <div className="slide-section-refs">
          <span>Cells:</span>
          {section.cell_refs.map((ref) => (
            <span key={ref} className="slide-cell-ref">
              {ref.slice(0, 8)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main SlideView ───────────────────────────────────────────────────────────

export function SlideView() {
  const notebook = useStore((s) => s.notebook);
  const slideLoading = useStore((s) => s.slideLoading);
  const generateSlide = useStore((s) => s.generateSlide);
  const updateSlideSections = useStore((s) => s.updateSlideSections);

  const sections = notebook?.slide.sections ?? [];
  const generated = notebook?.slide.generated ?? false;

  const handleUpdate = useCallback(
    (id: string, patch: Partial<Pick<SlideSection, 'title' | 'content'>>) => {
      const updated = sections.map((s) =>
        s.id === id ? { ...s, ...patch } : s,
      );
      updateSlideSections(updated);
    },
    [sections, updateSlideSections],
  );

  const handleDelete = useCallback(
    (id: string) => {
      const updated = sections
        .filter((s) => s.id !== id)
        .map((s, i) => ({ ...s, order: i }));
      updateSlideSections(updated);
    },
    [sections, updateSlideSections],
  );

  const handleMove = useCallback(
    (id: string, direction: 'up' | 'down') => {
      const idx = sections.findIndex((s) => s.id === id);
      if (idx === -1) return;
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= sections.length) return;

      const updated = [...sections];
      [updated[idx], updated[swapIdx]] = [updated[swapIdx], updated[idx]];
      // Re-index order values
      const reindexed = updated.map((s, i) => ({ ...s, order: i }));
      updateSlideSections(reindexed);
    },
    [sections, updateSlideSections],
  );

  // No notebook loaded
  if (!notebook) {
    return (
      <div className="slide-empty">
        <p>No notebook loaded.</p>
      </div>
    );
  }

  // Slide not yet generated
  if (!generated || sections.length === 0) {
    return (
      <div className="slide-empty">
        <p>No slide generated yet.</p>
        <p className="slide-empty-hint">
          Click the button below to generate a presentation summary from your notebook cells.
        </p>
        <div style={{ marginTop: '16px' }}>
          <button
            className="content-btn"
            onClick={() => generateSlide()}
            disabled={slideLoading}
          >
            {slideLoading ? 'Generating...' : 'Generate Slide'}
          </button>
        </div>
      </div>
    );
  }

  // Slide generated — show sections
  return (
    <div className="slide-view">
      <div className="slide-toolbar">
        <button
          className="content-btn"
          onClick={() => generateSlide()}
          disabled={slideLoading}
        >
          {slideLoading ? 'Regenerating...' : 'Re-generate Slide'}
        </button>
        <span className="slide-section-count">
          {sections.length} section{sections.length !== 1 ? 's' : ''}
        </span>
      </div>

      {[...sections]
        .sort((a, b) => a.order - b.order)
        .map((section, idx) => (
          <SlideSectionCard
            key={section.id}
            section={section}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
            onMove={handleMove}
            isFirst={idx === 0}
            isLast={idx === sections.length - 1}
          />
        ))}
    </div>
  );
}
