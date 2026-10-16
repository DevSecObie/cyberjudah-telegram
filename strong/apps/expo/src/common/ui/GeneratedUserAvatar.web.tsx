import { Blobatar } from '@blobatar/react'
import 'blobatar/motion.css'
import type { GeneratedUserAvatarProps } from './GeneratedUserAvatar'

const GeneratedUserAvatar = ({ animate = 'always', ...props }: GeneratedUserAvatarProps) => (
  <Blobatar {...props} animate={animate} />
)

export default GeneratedUserAvatar
