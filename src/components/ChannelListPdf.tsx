import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
// Bundled (not Google Fonts) so the PDF looks right even on a LAN with no internet.
// This file has Inter's optical-size axis: "Inter Display" is the same font at opsz 32,
// so one font covers both families the design uses. Only this preview loads it.
import '@fontsource-variable/inter/opsz.css';
import { Channel, Playlist } from '../apiClient';
import Dialog from './Dialog';
import { Logo } from './Logo';
import ChannelLogo from './ChannelLogo';
import Icon from './Icon';

/**
 * Printable channel list for one playlist, laid out as A4 pages to match the
 * designer's demo PDF. It's shown as a full-screen preview; "Save PDF" opens the
 * browser's print dialog, where the user picks "Save as PDF". Letting the browser
 * draw the pages means every logo format works and characters Inter doesn't have
 * (ᴴᴰ, ᴼᴿᴼ, emoji…) fall back to a system font instead of disappearing.
 *
 * The preview is a regular app dialog; only the sheets inside it get printed.
 */

// Rows per page, measured from the demo: A4 is 841.89pt tall, every row (channel or
// category bar) is 36.99pt, the bottom margin is 51pt, and the table starts 162pt from
// the top on page 1 (under the title block) and 51pt from the top on later pages.
// (841.89 − 162 − 51) / 36.99 = 17 rows, (841.89 − 51 − 51) / 36.99 = 20 rows.
const FIRST_PAGE_ROWS = 17;
const PAGE_ROWS = 20;

// If logos are still loading when "Save PDF" is pressed, wait at most this long so one
// dead logo server can't block saving. Unloaded logos print as initials or blank.
const LOGO_WAIT_MS = 15000;

// For fitting the preview: 210mm in CSS px, and the grey margin around the sheets.
const A4_WIDTH_PX = 210 * 96 / 25.4;
const SHEET_GUTTER_PX = 24;

type Row =
  | { kind: 'category'; name: string }
  // `shade` alternates light/darker rows, starting over in each category like the demo.
  | { kind: 'channel'; channel: Channel; number: number; shade: 0 | 1 };

// Same order as the playlist file players download (serveM3U in server.ts): hidden
// channels left out, categories in the playlist's order (unknown ones last), then each
// channel's position. Numbers count through that list, as most players number channels.
// One difference: categories missing from the playlist's list are kept together (sorted
// by name) instead of interleaved, so each still gets a single category bar.
function buildRows(playlist: Playlist, channels: Channel[]) {
  const catIndex = new Map(playlist.categories.map((cat, i) => [cat, i]));
  const rank = (c: Channel) => catIndex.get(c.category) ?? playlist.categories.length;
  const visible = channels
    .filter(c => !c.isHidden)
    .sort((a, b) => rank(a) - rank(b) || a.category.localeCompare(b.category) || a.order - b.order);

  const rows: Row[] = [];
  let currentCategory: string | null = null;
  let shade: 0 | 1 = 0;
  let categoryCount = 0;
  visible.forEach((channel, i) => {
    if (channel.category !== currentCategory) {
      currentCategory = channel.category;
      categoryCount++;
      shade = 0;
      rows.push({ kind: 'category', name: channel.category || 'Uncategorized' });
    }
    rows.push({ kind: 'channel', channel, number: i + 1, shade });
    shade = shade === 0 ? 1 : 0;
  });
  return { rows, channelCount: visible.length, categoryCount };
}

// Splits the rows into pages. A category bar never sits alone at the bottom of a
// page: it needs room for at least one of its channels, or it moves to the next page.
// Later pages just continue the rows without repeating the category bar, like the demo.
function paginate(rows: Row[]): Row[][] {
  const pages: Row[][] = [[]];
  for (const row of rows) {
    const page = pages[pages.length - 1];
    const capacity = pages.length === 1 ? FIRST_PAGE_ROWS : PAGE_ROWS;
    const needed = row.kind === 'category' ? 2 : 1;
    if (page.length + needed > capacity) pages.push([row]);
    else page.push(row);
  }
  return pages;
}

// The demo's own ✓ and ✕ shapes (copied from its vector paths, in pt), rather than
// icon-set glyphs, which have different proportions.
const EpgYesIcon = () => (
  <svg className="pdf-epg-icon" viewBox="0 0 11.23 9.51" style={{ width: '11.23pt', height: '9.51pt' }}>
    <path fill="currentColor" d="M0 4.928C0.229 4.47 0.688 3.897 1.49 4.126C2.178 4.355 2.636 5.043 2.98 5.96C5.731 2.865 8.023 0.688 10.774 0C11.117 0 11.232 0 11.003 0.229C8.023 2.292 5.158 5.387 2.866 9.398C2.751 9.513 2.636 9.513 2.522 9.398C2.063 8.252 1.719 7.106 1.146 5.96C0.917 5.387 0.573 4.928 0 4.928Z" />
  </svg>
);
const EpgNoIcon = () => (
  <svg className="pdf-epg-icon" viewBox="0 0 10.357 10.357" style={{ width: '10.36pt', height: '10.36pt' }}>
    <path fill="currentColor" d="M5.179 3.75L8.929 0L10.357 1.428L6.607 5.178L10.357 8.928L8.929 10.357L5.179 6.607L1.429 10.357L0 8.928L3.75 5.178L0 1.428L1.429 0Z" />
  </svg>
);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default function ChannelListPdf({ playlist, channels, tvgIdLabels, onClose }: {
  playlist: Playlist;
  channels: Channel[];
  /** tvgId → guide channel, from PlaylistEditor. A TVG-ID found here gets the green "EPG ✓". */
  tvgIdLabels: Record<string, unknown>;
  onClose: () => void;
}) {
  const sheetsRef = useRef<HTMLDivElement>(null);
  const [preparing, setPreparing] = useState<{ done: number; total: number } | null>(null);

  const { rows, channelCount, categoryCount } = useMemo(() => buildRows(playlist, channels), [playlist, channels]);
  const pages = useMemo(() => paginate(rows), [rows]);

  // The A4 sheets shrink to fit the dialog's width (never grow past real size). `zoom`
  // rather than a transform, so the scroll height shrinks with them; print resets it.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const fit = () => setZoom(Math.min(1, (el.clientWidth - SHEET_GUTTER_PX * 2) / A4_WIDTH_PX));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const savePdf = async () => {
    // Printing before the font and logos have loaded would bake fallbacks into the PDF.
    const images = [...(sheetsRef.current?.querySelectorAll('img') ?? [])];
    let done = images.filter(img => img.complete).length;
    setPreparing({ done, total: images.length });
    const logosLoaded = Promise.all(images.filter(img => !img.complete).map(img =>
      new Promise<void>(resolve => {
        const finish = () => { done++; setPreparing({ done, total: images.length }); resolve(); };
        img.addEventListener('load', finish, { once: true });
        img.addEventListener('error', finish, { once: true });
      })));
    await Promise.race([
      Promise.all([document.fonts.ready, logosLoaded]),
      new Promise(resolve => setTimeout(resolve, LOGO_WAIT_MS)),
    ]);
    setPreparing(null);

    // Browsers suggest the page title as the PDF's file name.
    const previousTitle = document.title;
    document.title = `${playlist.name} channel list`;
    window.print();
    document.title = previousTitle;
  };

  // Portaled into <body>, outside #root, so the print CSS in index.css can hide the
  // whole app. The `pdf-print-reset` classes undo the dialog's layout when printing,
  // and the header/footer (`pdf-no-print`) aren't printed at all.
  return createPortal(
    <div className="pdf-print-root">
      <Dialog
        onClose={onClose}
        maxWidth="max-w-4xl"
        panelClassName="overflow-hidden h-[90vh] pdf-print-reset"
        scrimClassName="bg-black/40 pdf-print-reset"
        dismissible={!preparing}
      >
        {/* Header */}
        <div className="pdf-no-print flex items-center gap-3 px-6 pt-6 pb-4 shrink-0">
          <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-secondary-container text-on-secondary-container">
            <Icon name="description" className="text-[24px]" />
          </div>
          <h2 className="min-w-0 text-headline-sm text-on-surface truncate">{playlist.name} channel list</h2>
        </div>

        <div ref={scrollRef} className="pdf-print-reset flex-1 min-h-0 overflow-y-auto bg-page border-y border-outline-variant">
          <div ref={sheetsRef} className="pdf-sheets" style={{ zoom }}>
            {pages.map((pageRows, pageIndex) => (
              <section key={pageIndex} className="pdf-page">
                {pageIndex === 0 && (
                  <>
                    <h1 className="pdf-title">{playlist.name}</h1>
                    <p className="pdf-subtitle">{plural(channelCount, 'channel', 'channels')} • {plural(categoryCount, 'category', 'categories')}</p>
                    <p className="pdf-credit">
                      Created with <Logo iconFill="currentColor" className="pdf-credit-logo" width={undefined} height={undefined} />
                    </p>
                  </>
                )}
                <div className="pdf-table" style={{ top: pageIndex === 0 ? '162pt' : '51pt' }}>
                  {pageRows.map((row, i) => row.kind === 'category' ? (
                    <div key={`cat-${i}`} className="pdf-category">{row.name}</div>
                  ) : (
                    <div key={row.channel.id} className={`pdf-row ${row.shade ? 'pdf-row-alt' : ''}`}>
                      <div className="pdf-number">{row.number}</div>
                      <div className="pdf-logo-cell">
                        <ChannelLogo logo={row.channel.logo} name={row.channel.name} logoBgColor="transparent" className="pdf-logo" />
                      </div>
                      <div className="pdf-name" title={row.channel.name}>{row.channel.name}</div>
                      <div className="pdf-epg">
                        {row.channel.tvgId && tvgIdLabels[row.channel.tvgId] ? (
                          <span className="pdf-epg-yes">EPG<EpgYesIcon /></span>
                        ) : (
                          <span className="pdf-epg-no">EPG<EpgNoIcon /></span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="pdf-page-number">{pageIndex + 1}</div>
              </section>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="pdf-no-print px-6 py-4 shrink-0 flex items-center justify-end gap-2">
          {preparing && (
            <p className="flex-1 text-body-sm text-on-surface-variant">Loading logos… {preparing.done} of {preparing.total}</p>
          )}
          <button onClick={onClose} disabled={!!preparing} className="md-btn btn btn-text">Cancel</button>
          <button
            onClick={savePdf}
            disabled={!!preparing}
            className="md-btn btn btn-filled"
          >
            <Icon name="picture_as_pdf" className="text-[20px]" />
            Save PDF
          </button>
        </div>
      </Dialog>
    </div>,
    document.body,
  );
}
