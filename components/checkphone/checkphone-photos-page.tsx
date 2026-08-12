"use client";

import { useEffect, useMemo, useState } from "react";
import { appNowISO } from "@/lib/app-clock";
import { useCheckPhoneRefresh } from "@/lib/checkphone-refresh-tracker";
import { ChevronLeft, RefreshCw, Trash2 } from "lucide-react";
import { CheckPhoneBilingualText } from "@/components/checkphone/checkphone-bilingual-text";
import { CheckPhoneDebugErrorCard } from "@/components/checkphone/checkphone-debug-error-card";
import { ConfirmDialog } from "@/components/ui";
import type { Character } from "@/lib/character-types";
import type {
  CheckPhonePhotoAlbum,
  CheckPhonePhotoItem,
  CheckPhonePhotosPayload,
  CheckPhoneSnapshot,
} from "@/lib/checkphone-config";
import { generateCheckPhonePhotos } from "@/lib/checkphone-engine";
import { clearPhoneSnapshot, loadPhoneSnapshot, savePhoneSnapshot } from "@/lib/checkphone-storage";

type CheckPhonePhotosPageProps = {
  character: Character;
  onBack: () => void;
};

function getToneClass(tone: CheckPhonePhotoItem["tone"]): string {
  return `cp-photo-thumb--${tone}`;
}

function PhotoPreviewIcon({ icon, large = false }: { icon: string; large?: boolean }) {
  return (
    <div className={`cp-photo-preview-icon ${large ? "cp-photo-preview-icon--large" : ""}`} aria-hidden="true">
      {icon}
    </div>
  );
}

export function CheckPhonePhotosPage({ character, onBack }: CheckPhonePhotosPageProps) {
  const [snapshot, setSnapshot] = useState<CheckPhoneSnapshot<CheckPhonePhotosPayload> | null>(null);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [homeSection, setHomeSection] = useState<"featured" | "albums" | "recent">("featured");
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useCheckPhoneRefresh(character.id, "photos", setSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [debugRawOutput, setDebugRawOutput] = useState<string | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setError(null);
    setDebugRawOutput(null);
    setSnapshot(null);
    setSelectedAlbumId(null);
    setSelectedPhotoId(null);
    setHomeSection("featured");
    (async () => {
      const cached = await loadPhoneSnapshot<CheckPhonePhotosPayload>(character.id, "photos");
      if (cancelled) return;
      setSnapshot(cached);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [character.id]);

  async function handleRefresh() {
    if (loading) return;
    setLoading(true);
    setError(null);
    setDebugRawOutput(null);
    const {
      payload,
      summary,
      error: nextError,
      debugRawOutput: nextDebugRawOutput,
    } = await generateCheckPhonePhotos(
      character.id,
      snapshot?.payload ?? null,
      snapshot?.updatedAt,
    );
    if (payload) {
      const now = appNowISO();
      const nextSnapshot: CheckPhoneSnapshot<CheckPhonePhotosPayload> = {
        id: `${character.id}:photos`,
        characterId: character.id,
        appId: "photos",
        generatedAt: snapshot?.generatedAt ?? now,
        updatedAt: now,
        summary,
        payload,
      };
      await savePhoneSnapshot(nextSnapshot);
      setSnapshot(nextSnapshot);
      setSelectedAlbumId(null);
      setSelectedPhotoId(null);
      setHomeSection("featured");
    }
    setError(nextError ?? null);
    setDebugRawOutput(nextDebugRawOutput ?? null);
    setLoading(false);
    setLoaded(true);
  }

  async function handleClear() {
    if (loading) return;
    await clearPhoneSnapshot(character.id, "photos");
    setSnapshot(null);
    setSelectedAlbumId(null);
    setSelectedPhotoId(null);
    setHomeSection("featured");
    setError(null);
    setDebugRawOutput(null);
    setLoaded(true);
    setConfirmClearOpen(false);
  }

  const payload = snapshot?.payload ?? null;
  const albums = payload?.albums ?? [];
  const photos = payload?.photos ?? [];
  const featuredPhoto = useMemo(
    () => photos.find((photo) => photo.id === payload?.featuredPhotoId) ?? photos[0] ?? null,
    [photos, payload?.featuredPhotoId],
  );
  const selectedAlbum = useMemo<CheckPhonePhotoAlbum | null>(
    () => albums.find((album) => album.id === selectedAlbumId) ?? null,
    [albums, selectedAlbumId],
  );
  const selectedPhoto = useMemo<CheckPhonePhotoItem | null>(
    () => photos.find((photo) => photo.id === selectedPhotoId) ?? null,
    [photos, selectedPhotoId],
  );
  const albumPhotos = useMemo(
    () => (selectedAlbum ? photos.filter((photo) => photo.albumId === selectedAlbum.id) : []),
    [photos, selectedAlbum],
  );
  const highlightedPhotos = useMemo(() => photos.slice(0, 4), [photos]);

  const backAction = selectedPhoto
    ? () => setSelectedPhotoId(null)
    : selectedAlbum
      ? () => setSelectedAlbumId(null)
      : onBack;

  const subtitle = selectedPhoto
    ? selectedPhoto.locationLabel
    : selectedAlbum
      ? selectedAlbum.title
      : payload?.headerSubtitle || "相册与回忆";

  return (
    <div className="cp-photos-module">
      <header className="cp-browser-appbar cp-browser-appbar--unified">
        <div className="cp-browser-unified-compact">
          <div className="cp-unified-header-left">
            <button type="button" className="cp-unified-btn" onClick={backAction} aria-label="Back">
              <ChevronLeft size={20} strokeWidth={2.5} />
            </button>
          </div>

          <div className="cp-unified-title-stack">
            <div className="cp-unified-title-row">
              <i className="cp-unified-blink"></i>
              <span className="cp-unified-title">{payload?.headerTitle || "相册"}</span>
            </div>
            <div className="cp-unified-subtitle">{subtitle}</div>
          </div>

          <div className="cp-unified-header-right">
            <div className="cp-unified-actions">
              <button type="button" className="cp-unified-btn" onClick={handleRefresh} disabled={loading} aria-label="Refresh">
                <RefreshCw size={16} strokeWidth={2.5} className={loading ? "cp-spin" : ""} />
              </button>
              <button
                type="button"
                className="cp-unified-btn cp-unified-btn--danger"
                onClick={() => setConfirmClearOpen(true)}
                disabled={loading || !snapshot}
                aria-label="Clear photos snapshot"
              >
                <Trash2 size={16} strokeWidth={2.5} />
              </button>
            </div>
          </div>
        </div>
        
        <div className="cp-unified-status-bar">
          <span className="cp-unified-mini-text">[ SYS.NET : ONLINE ]</span>
          <span className="cp-unified-mini-text">SEC 9 {">"} PORT 443</span>
        </div>
      </header>

      {loading && (
        <div className="cp-refresh-indicator cp-refresh-indicator--floating" aria-live="polite">
          <span className="cp-refresh-indicator-text">正在刷新相册</span>
          <span className="cp-refresh-indicator-dots" aria-hidden="true">
            <i></i><i></i><i></i>
          </span>
        </div>
      )}

      <div className="cp-photos-body">
        {!loaded && <div className="cp-photos-status">Reading frames...</div>}

        {loaded && !payload && !loading && (
          <div className="cp-photos-status cp-empty-copy">
            <p>暂无照片内容</p>
            <span className="cp-photos-hint">点刷新同步相簿和最近照片</span>
          </div>
        )}

        {error ? <CheckPhoneDebugErrorCard error={error} debugRawOutput={debugRawOutput} /> : null}

        {payload && !selectedAlbum && !selectedPhoto && (
          <div className="cp-photos-scroll">
            <section className="cp-photo-overview-hero">
              <span className="cp-photo-overview-kicker">MOMENTS</span>
              <div className="cp-photo-overview-metrics">
                <span>{albums.length} 个相簿</span>
                <span>{photos.length} 张照片</span>
              </div>
            </section>

            <div className="cp-photo-overview-tabs" role="tablist" aria-label="相册分区">
              {[
                { id: "featured", label: "精选" },
                { id: "albums", label: "相簿" },
                { id: "recent", label: "最近" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`cp-photo-overview-tab ${homeSection === tab.id ? "is-active" : ""}`}
                  onClick={() => setHomeSection(tab.id as "featured" | "albums" | "recent")}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {homeSection === "featured" && featuredPhoto && (
              <section className="cp-photo-feature">
                <div className={`cp-photo-feature-frame ${getToneClass(featuredPhoto.tone)}`}>
                  <PhotoPreviewIcon icon={featuredPhoto.previewIcon} large />
                  <div className="cp-photo-feature-caption">
                    <span>{featuredPhoto.shotAtLabel}</span>
                    <h3><CheckPhoneBilingualText text={featuredPhoto.title} tone="photos" /></h3>
                  </div>
                  <button type="button" className="cp-photo-open-hit" onClick={() => setSelectedPhotoId(featuredPhoto.id)} aria-label="Open featured photo" />
                </div>
                <div className="cp-photo-feature-footnote">
                  <span>{featuredPhoto.locationLabel}</span>
                  <b>精选记录</b>
                </div>
                {highlightedPhotos.length > 1 ? (
                  <div className="cp-photo-mini-grid">
                    {highlightedPhotos.slice(1).map((photo) => (
                      <button
                        key={photo.id}
                        type="button"
                        className={`cp-photo-mini-card ${getToneClass(photo.tone)}`}
                        onClick={() => setSelectedPhotoId(photo.id)}
                      >
                        <PhotoPreviewIcon icon={photo.previewIcon} />
                        <span><CheckPhoneBilingualText text={photo.title} tone="photos" /></span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </section>
            )}

            {homeSection === "albums" && (
              <section className="cp-photo-albums">
                <div className="cp-photo-section-title">相簿</div>
                <div className="cp-photo-album-list">
                  {albums.map((album) => {
                    const cover = photos.find((photo) => photo.id === album.coverPhotoId);
                    return (
                      <button key={album.id} type="button" className="cp-photo-album-card" onClick={() => setSelectedAlbumId(album.id)}>
                        <div className={`cp-photo-album-cover ${cover ? getToneClass(cover.tone) : "cp-photo-thumb--mist"}`}>
                          {cover ? <PhotoPreviewIcon icon={cover.previewIcon} /> : null}
                        </div>
                        <div className="cp-photo-album-meta">
                          <div>
                            <span className="cp-photo-album-eyebrow">{album.updatedLabel}</span>
                            <h4><CheckPhoneBilingualText text={album.title} tone="photos" /></h4>
                            <p><CheckPhoneBilingualText text={album.moodLabel} tone="photos" /></p>
                          </div>
                          <div className="cp-photo-album-side">
                            <span>共</span>
                            <b>{album.count}</b>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {homeSection === "recent" && (
              <section className="cp-photo-grid-wrap">
                <div className="cp-photo-section-title">最近照片</div>
                <div className="cp-photo-grid cp-photo-grid--editorial">
                  {photos.slice(0, 12).map((photo, index) => (
                    <button
                      key={photo.id}
                      type="button"
                      className={`cp-photo-grid-item ${getToneClass(photo.tone)} ${index === 0 ? "is-large" : ""}`}
                      onClick={() => setSelectedPhotoId(photo.id)}
                    >
                      <PhotoPreviewIcon icon={photo.previewIcon} />
                      <span><CheckPhoneBilingualText text={photo.title} tone="photos" /></span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {payload && selectedAlbum && !selectedPhoto && (
          <div className="cp-photos-scroll">
            <section className="cp-photo-album-hero">
              <div className="cp-photo-section-title">相簿详情</div>
              <h3><CheckPhoneBilingualText text={selectedAlbum.title} tone="photos" /></h3>
              <p><CheckPhoneBilingualText text={selectedAlbum.moodLabel} tone="photos" /></p>
              <div className="cp-photo-overview-metrics cp-photo-overview-metrics--compact">
                <span>{selectedAlbum.count} 张照片</span>
                <span>{selectedAlbum.updatedLabel}</span>
              </div>
            </section>
            <div className="cp-photo-grid cp-photo-grid--editorial">
              {albumPhotos.map((photo) => (
                <button
                  key={photo.id}
                  type="button"
                  className={`cp-photo-grid-item ${getToneClass(photo.tone)}`}
                  onClick={() => setSelectedPhotoId(photo.id)}
                >
                  <PhotoPreviewIcon icon={photo.previewIcon} />
                  <span><CheckPhoneBilingualText text={photo.title} tone="photos" /></span>
                </button>
              ))}
            </div>
          </div>
        )}

        {payload && selectedPhoto && (
          <div className="cp-photos-scroll">
            <article className="cp-photo-detail">
              <div className={`cp-photo-detail-frame ${getToneClass(selectedPhoto.tone)}`}>
                <PhotoPreviewIcon icon={selectedPhoto.previewIcon} large />
              </div>
              <div className="cp-photo-detail-meta">
                <div className="cp-photo-detail-kicker">{selectedPhoto.shotAtLabel}</div>
                <h3><CheckPhoneBilingualText text={selectedPhoto.title} tone="photos" /></h3>
                <div className="cp-photo-detail-chips">
                  <span className="cp-photo-detail-location">{selectedPhoto.locationLabel}</span>
                  <span>{selectedAlbum?.title ?? "照片"}</span>
                </div>
                <p><CheckPhoneBilingualText text={selectedPhoto.description} tone="photos" /></p>
              </div>
            </article>
          </div>
        )}
      </div>
      {confirmClearOpen && (
        <ConfirmDialog
          title="清空相册内容？"
          message="确认后会清空当前相册缓存。之后重新刷新时，不会再带入旧相册内容。"
          variant="danger"
          confirmLabel="确认清空"
          cancelLabel="取消"
          onConfirm={handleClear}
          onCancel={() => setConfirmClearOpen(false)}
        />
      )}
    </div>
  );
}
