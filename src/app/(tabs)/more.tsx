import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { IconButton, IconTile, ListCard, ListRow, Screen, ScreenTitle, Section, Text } from '@/components/ui';
import type { IconName } from '@/data/icons';
import { colors, spacing } from '@/theme/tokens';

type Link = { title: string; subtitle: string; icon: IconName; href: string };

const GROUPS: { title: string; links: Link[] }[] = [
  {
    title: 'Money',
    links: [
      { title: 'Net worth', subtitle: 'What you own minus what you owe', icon: 'bar-chart-2', href: '/net-worth' },
      { title: 'Debt', subtitle: 'Balances and payoff progress', icon: 'trending-down', href: '/debt' },
      { title: 'Savings', subtitle: 'Savings accounts and goals', icon: 'shield', href: '/savings' },
      { title: 'Investments', subtitle: 'Contributions, value and gains', icon: 'trending-up', href: '/investments' },
      { title: 'Assets', subtitle: 'Vehicles, electronics and valuables', icon: 'box', href: '/belongings' },
    ],
  },
  {
    title: 'Plan',
    links: [
      { title: 'Bills & recurring', subtitle: 'Everything you pay on a schedule', icon: 'file-text', href: '/bills' },
      { title: 'Subscriptions', subtitle: 'Monthly and yearly services', icon: 'refresh-cw', href: '/subscriptions' },
      { title: 'Income', subtitle: 'Paychecks and other sources', icon: 'briefcase', href: '/income' },
      { title: 'Taxes', subtitle: 'Estimate, deductions and documents', icon: 'percent', href: '/taxes' },
      { title: 'Work benefits', subtitle: '401(k) match earned and missed', icon: 'gift', href: '/benefits' },
      { title: 'HSA reimbursements', subtitle: 'Medical bills you can still claim back', icon: 'heart', href: '/hsa' },
      { title: 'Calendar', subtitle: 'Paydays, bills and transfers by date', icon: 'calendar', href: '/calendar' },
      { title: 'Cash-flow forecast', subtitle: 'Projected cash for the weeks ahead', icon: 'activity', href: '/forecast' },
      { title: 'Budgets', subtitle: 'Optional limits by category', icon: 'pie-chart', href: '/budgets' },
      { title: 'Goals', subtitle: 'What you are working toward', icon: 'flag', href: '/goals' },
      { title: 'Sinking funds', subtitle: 'Money set aside for irregular costs', icon: 'umbrella', href: '/sinking' },
      { title: 'Reminders & lock', subtitle: 'Bill alerts and locking the app', icon: 'bell', href: '/reminders' },
    ],
  },
  {
    title: 'Understand',
    links: [
      { title: 'Can I afford it?', subtitle: 'Car, rent, home or a big purchase', icon: 'check-square', href: '/afford' },
      { title: 'Spending map', subtitle: 'Where it goes, and what is easy to forget', icon: 'map', href: '/spending-map' },
      { title: 'Reports', subtitle: 'Trends, comparisons and breakdowns', icon: 'bar-chart', href: '/reports' },
      { title: 'Monthly review', subtitle: 'A full summary of any month', icon: 'book-open', href: '/review' },
      { title: 'Year in review', subtitle: 'Your whole year in numbers', icon: 'award', href: '/year-in-review' },
      { title: 'Retirement outlook', subtitle: 'Where this path lands', icon: 'sunrise', href: '/retirement' },
      { title: 'What-if scenarios', subtitle: 'Model changes without touching real data', icon: 'git-branch', href: '/scenarios' },
    ],
  },
  {
    title: 'Organize',
    links: [
      { title: 'Insurance & warranties', subtitle: 'Renewals, claims and cover', icon: 'shield', href: '/policies' },
      { title: 'IOUs', subtitle: 'Money lent to or borrowed from people', icon: 'users', href: '/ious' },
      { title: 'Categories', subtitle: 'Spending and income categories', icon: 'tag', href: '/categories' },
      { title: 'Tidy up', subtitle: 'File transactions that have no category', icon: 'check-square', href: '/tidy' },
      { title: 'Settings & data', subtitle: 'Backup, import and privacy', icon: 'settings', href: '/settings' },
    ],
  },
];

export default function MoreScreen() {
  const router = useRouter();
  return (
    <Screen tabBar>
      <ScreenTitle title="More" actions={<IconButton icon="search" accessibilityLabel="Search everything" onPress={() => router.push('/search')} />} />
      {GROUPS.map((group) => (
        <Section key={group.title} title={group.title}>
          <ListCard>
            {group.links.map((link) => (
              <ListRow key={link.href} title={link.title} subtitle={link.subtitle} leading={<IconTile icon={link.icon} />} chevron onPress={() => router.push(link.href as never)} />
            ))}
          </ListCard>
        </Section>
      ))}
      <View style={styles.footer}>
        <Text variant="caption" color={colors.textTertiary} align="center">
          Your financial data is stored only on this device.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: { paddingBottom: spacing.lg },
});
