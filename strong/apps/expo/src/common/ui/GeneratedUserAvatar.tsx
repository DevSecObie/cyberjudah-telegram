import { Blobatar, type BlobatarProps } from '@blobatar/react-native'

export type GeneratedUserAvatarProps = Pick<BlobatarProps, 'name' | 'size' | 'traits'> & {
  /** Web only: when the face moves (always, or while hovered). */
  animate?: 'hover' | 'always'
}

const GeneratedUserAvatar = ({ animate: _animate, ...props }: GeneratedUserAvatarProps) => (
  <Blobatar {...props} />
)

export default GeneratedUserAvatar
