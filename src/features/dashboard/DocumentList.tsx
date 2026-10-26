import {
  DeleteOutlined,
  FilePdfOutlined,
  FolderOpenOutlined,
} from '@ant-design/icons'
import { Button, List, Space, Tag, Tooltip, Typography } from 'antd'
import { formatLastEdited } from '@/lib/formatDate'
import type { DocumentRecord } from '@/types/documentRecord'
import styles from './DocumentList.module.css'

const { Text } = Typography

interface DocumentListProps {
  documents: readonly DocumentRecord[]
  onOpen: (document: DocumentRecord) => void
  onDelete: (document: DocumentRecord) => void
}

export function DocumentList({
  documents,
  onOpen,
  onDelete,
}: DocumentListProps) {
  return (
    <List
      className={styles.list}
      itemLayout="horizontal"
      dataSource={[...documents]}
      renderItem={(document) => (
        <List.Item
          className={styles.item}
          actions={[
            <Button
              key="open"
              type="link"
              size="small"
              icon={<FolderOpenOutlined />}
              onClick={() => onOpen(document)}
            >
              Open
            </Button>,
            document.source === 'user' ? (
              <Button
                key="delete"
                type="link"
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() => onDelete(document)}
              >
                Delete
              </Button>
            ) : (
              <Tooltip key="delete" title="Sample documents cannot be deleted">
                <Button type="link" size="small" disabled icon={<DeleteOutlined />}>
                  Delete
                </Button>
              </Tooltip>
            ),
          ]}
        >
          <List.Item.Meta
            avatar={
              <span className={styles.avatar} aria-hidden>
                <FilePdfOutlined />
              </span>
            }
            title={
              <Space size={6} wrap>
                <Text strong className={styles.fileName}>
                  {document.name}
                </Text>
                {document.source === 'demo' ? (
                  <Tag bordered={false} className={styles.sampleTag}>
                    Sample
                  </Tag>
                ) : (
                  <Tag color="blue" bordered={false}>
                    Your upload
                  </Tag>
                )}
              </Space>
            }
            description={
              <span className={styles.meta}>
                {document.pageCount} pages · Last edited{' '}
                {formatLastEdited(document.lastEditedAt)}
              </span>
            }
          />
        </List.Item>
      )}
    />
  )
}
