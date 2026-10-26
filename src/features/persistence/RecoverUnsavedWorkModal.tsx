import { Alert, Button, Modal, Typography } from 'antd'
import { formatLastSavedAt } from '@/lib/persistence/formatLastSaved'

const { Paragraph, Text } = Typography

interface RecoverUnsavedWorkModalProps {
  open: boolean
  documentName: string
  recoveryAt: string
  savedAt: string | null
  onUseRecovery: () => void
  onUseLastSaved: () => void
}

export function RecoverUnsavedWorkModal({
  open,
  documentName,
  recoveryAt,
  savedAt,
  onUseRecovery,
  onUseLastSaved,
}: RecoverUnsavedWorkModalProps) {
  return (
    <Modal
      title="Recover unsaved work?"
      open={open}
      onCancel={onUseLastSaved}
      footer={
        <>
          <Button onClick={onUseLastSaved}>Use last saved</Button>
          <Button type="primary" onClick={onUseRecovery}>
            Recover unsaved edits
          </Button>
        </>
      }
      destroyOnHidden
    >
      <Alert
        type="info"
        showIcon
        message="Local browser storage only"
        description="Recovery uses a draft saved on this device. It is not backed up to the cloud and may be cleared if you wipe browser data."
        style={{ marginBottom: 12 }}
      />
      <Paragraph>
        We found a newer local draft for <Text strong>{documentName}</Text>.
      </Paragraph>
      <Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 0 }}>
        Unsaved draft: {formatLastSavedAt(recoveryAt) ?? recoveryAt}
        {savedAt ? (
          <>
            {' '}
            · Last saved: {formatLastSavedAt(savedAt) ?? savedAt}
          </>
        ) : (
          <> · No completed save found yet</>
        )}
      </Paragraph>
    </Modal>
  )
}
