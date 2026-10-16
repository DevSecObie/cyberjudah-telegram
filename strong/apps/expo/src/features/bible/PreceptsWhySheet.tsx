import { useQuery } from '@tanstack/react-query'
import { useState, type Ref } from 'react'
import { Sheet, SheetHeader, SheetScrollView, type SheetRef } from '~common/sheet'
import Box, { TouchableBox } from '~common/ui/Box'
import { FeatherIcon } from '~common/ui/Icon'
import Text from '~common/ui/Text'
import {
  fetchVersePrecepts,
  formatClassDate,
  type PreceptClass,
  type VersePrecepts,
} from './precepts'

/**
 * CyberJudah: the note that leads a verse's precepts, as the app has always shown it
 * (app/src/bible/ui/WhySheet.tsx): why each precept is there, one card each, from the class that
 * lined it up, with the precept's own words. Tapping a precept reads it; the class line opens the
 * class at that moment.
 */
type Props = {
  ref?: Ref<SheetRef>
  target: { book: number; chapter: number; verse: number } | null
  onRead: (osis: string) => void
  onOpenClass: (path: string) => void
}

const classLine = (c: PreceptClass, more = 0) =>
  [c.label, c.date ? formatClassDate(c.date) : '', c.ts].filter(Boolean).join(' · ') +
  (more ? ` · and ${more} more class${more > 1 ? 'es' : ''}` : '')

export default function PreceptsWhySheet({ ref, target, onRead, onOpenClass }: Props) {
  const query = useQuery({
    queryKey: ['cyberjudah-precept-why', target?.book, target?.chapter, target?.verse],
    queryFn: () => fetchVersePrecepts(target!.book, target!.chapter, target!.verse),
    enabled: Boolean(target),
    staleTime: 60 * 60 * 1000,
  })
  const data: VersePrecepts | undefined = query.data
  return (
    <Sheet
      ref={ref}
      snapPoints={[1]}
      header={<SheetHeader title={data?.reference ?? ''} subTitle={data?.title ?? 'Precepts'} />}
    >
      <SheetScrollView>
        <Box className="gap-[12px] px-[16px] pt-[8px] pb-[24px]">
          {data?.leads.map(lead => (
            <Box
              key={`lead|${lead.point}`}
              className="gap-[6px] pl-[14px] pr-[4px] py-[2px] border-l-[3px] border-primary"
            >
              <Text className="text-[15px] leading-[22px] text-default">{lead.point}</Text>
              <TouchableBox onPress={() => onOpenClass(lead.class.path)}>
                <Text className="text-[12.5px] text-tertiary">{classLine(lead.class)}</Text>
              </TouchableBox>
            </Box>
          ))}
          {query.isPending ? (
            <Text className="text-tertiary">Loading...</Text>
          ) : !data?.items.length ? (
            <Text className="text-tertiary">No precept is lined up with this verse.</Text>
          ) : (
            data.items.map(item => (
              <PreceptCard
                key={`${item.kind}|${item.label}`}
                item={item}
                onRead={onRead}
                onOpenClass={onOpenClass}
              />
            ))
          )}
        </Box>
      </SheetScrollView>
    </Sheet>
  )
}

function PreceptCard({
  item,
  onRead,
  onOpenClass,
}: {
  item: VersePrecepts['items'][number]
  onRead: (osis: string) => void
  onOpenClass: (path: string) => void
}) {
  // A breakdown opens on its first paragraph; "Read more" shows the rest.
  const [open, setOpen] = useState(false)
  const paragraphs = item.why
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean)
  const shown = open ? paragraphs : paragraphs.slice(0, 1)
  return (
    <Box className="gap-[6px] px-[14px] py-[12px] rounded-[14px] bg-light-grey">
      <TouchableBox
        className="flex-row items-center gap-[8px]"
        disabled={!item.osis}
        onPress={() => item.osis && onRead(item.osis)}
        accessibilityRole="link"
      >
        <Box className="px-[8px] py-[1px] rounded-full bg-reverse">
          <Text className="text-[11px] font-bold text-tertiary">
            {item.kind === 'precept' ? 'Precept' : 'Precept for'}
          </Text>
        </Box>
        <Text className="flex-1 text-[16px] font-bold text-primary">{item.label}</Text>
        <FeatherIcon name="chevron-right" size={15} color="tertiary" />
      </TouchableBox>
      {item.words ? (
        <Text className="text-[15px] leading-[22px] italic text-tertiary" numberOfLines={3}>
          {item.words}
        </Text>
      ) : null}
      {shown.map((p, i) => (
        <Text key={i} className="text-[15px] leading-[22px] text-default">
          {p}
        </Text>
      ))}
      {!open && paragraphs.length > 1 ? (
        <TouchableBox onPress={() => setOpen(true)}>
          <Text className="text-[14px] font-semibold text-primary">Read more</Text>
        </TouchableBox>
      ) : null}
      {item.why || item.more ? (
        <TouchableBox onPress={() => onOpenClass(item.class.path)}>
          <Text className="text-[12.5px] text-tertiary">{classLine(item.class, item.more)}</Text>
        </TouchableBox>
      ) : null}
    </Box>
  )
}
