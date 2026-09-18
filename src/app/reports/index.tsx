import { useRouter } from 'expo-router';

import { REPORT_SECTIONS } from '@/components/reports/catalog';
import { IconTile, ListCard, ListRow, NavHeader, Screen, Section, Text } from '@/components/ui';
import { colors } from '@/theme/tokens';

export default function ReportsScreen() {
  const router = useRouter();
  return (
    <Screen header={<NavHeader title="Reports" />}>
      <Text color={colors.textSecondary}>Pick a question. Each report answers it with one chart, the numbers behind it and a plain-language takeaway.</Text>
      {REPORT_SECTIONS.map((section) => (
        <Section key={section.title} title={section.title}>
          <ListCard>
            {section.reports.map((r) => (
              <ListRow key={r.id} title={r.question} subtitle={r.subtitle} leading={<IconTile icon={r.icon} />} chevron onPress={() => router.push(`/reports/${r.id}`)} />
            ))}
          </ListCard>
        </Section>
      ))}
    </Screen>
  );
}
