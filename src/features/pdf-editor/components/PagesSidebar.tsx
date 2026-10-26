import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import { Button, Spin, Tooltip, Typography } from 'antd'
import { PageThumbnail } from '@/features/pdf-viewer/PageThumbnail'
import { usePdfViewer } from '@/features/pdf-viewer/PdfViewerContext'
import styles from './PagesSidebar.module.css'

const { Text } = Typography

interface PagesSidebarProps {
  pageCount: number
  activePage: number
  onPageSelect: (page: number) => void
  collapsed: boolean
  onToggleCollapse: () => void
}

export function PagesSidebar({
  pageCount,
  activePage,
  onPageSelect,
  collapsed,
  onToggleCollapse,
}: PagesSidebarProps) {
  const { status, pageCount: livePageCount } = usePdfViewer()
  const totalPages = livePageCount || pageCount
  const pages = Array.from({ length: totalPages }, (_, index) => index + 1)
  const canNavigate = status === 'ready' && totalPages > 0

  return (
    <aside
      className={collapsed ? styles.rootCollapsed : styles.root}
      aria-label="Pages sidebar"
    >
      <div className={styles.header}>
        {!collapsed ? (
          <Text strong className={styles.title}>
            Pages
          </Text>
        ) : null}
        <Tooltip title={collapsed ? 'Expand pages' : 'Collapse pages'}>
          <Button
            type="text"
            size="small"
            icon={collapsed ? <RightOutlined /> : <LeftOutlined />}
            onClick={onToggleCollapse}
            aria-label={collapsed ? 'Expand pages sidebar' : 'Collapse pages sidebar'}
          />
        </Tooltip>
      </div>
      {!collapsed ? (
        <>
          <div className={styles.nav}>
            <Button
              size="small"
              disabled={!canNavigate || activePage <= 1}
              onClick={() => onPageSelect(activePage - 1)}
            >
              Previous
            </Button>
            <Text type="secondary" className={styles.pageIndicator}>
              {activePage} / {totalPages}
            </Text>
            <Button
              size="small"
              disabled={!canNavigate || activePage >= totalPages}
              onClick={() => onPageSelect(activePage + 1)}
            >
              Next
            </Button>
          </div>
          <div className={styles.thumbs}>
            {status === 'loading' ? (
              <div className={styles.thumbLoading}>
                <Spin size="small" />
              </div>
            ) : null}
            {status === 'ready'
              ? pages.map((page) => (
                  <PageThumbnail
                    key={page}
                    pageNumber={page}
                    selected={page === activePage}
                    onSelect={() => onPageSelect(page)}
                  />
                ))
              : null}
            {status !== 'ready' && status !== 'loading'
              ? pages.map((page) => (
                  <button
                    key={page}
                    type="button"
                    className={
                      page === activePage ? styles.thumbStaticActive : styles.thumbStatic
                    }
                    disabled
                    aria-label={`Page ${page}`}
                  >
                    <span className={styles.thumbPreview} aria-hidden />
                    <span className={styles.thumbLabel}>{page}</span>
                  </button>
                ))
              : null}
          </div>
        </>
      ) : null}
    </aside>
  )
}
