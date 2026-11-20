import { useMemo, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { initials } from '@/components/shared';
import {
  useNotifications,
  useUnreadNotificationCount,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  type Notification,
} from '@/api/hooks';

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}

function NotificationRow({ item, onOpen }: { item: Notification; onOpen: (item: Notification) => void }) {
  const unread = !item.readAt;
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className={cn(
        'flex w-full gap-3 border-b border-border/60 px-4 py-3 text-left last:border-b-0 hover:bg-secondary/60',
        unread && 'bg-primary/[0.04]',
      )}
    >
      <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', unread ? 'bg-accent' : 'bg-transparent')} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-[13px]', unread ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground')}>
          {item.title}
        </span>
        {item.body && <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">{item.body}</span>}
        <span className="mt-1 block font-mono text-[9px] uppercase tracking-[.14em] text-muted-foreground/70">{relativeTime(item.createdAt)}</span>
      </span>
    </button>
  );
}

/**
 * A.2 notification bell. Round 7 gap 6: the unread count is fetched on load (one cheap
 * request, refreshed once a minute), so the badge is right before the panel is ever opened.
 * Opening the panel is what loads the list itself.
 */
export function NotificationBell({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const notifications = useNotifications(open);
  const count = useUnreadNotificationCount(!open);
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const items = notifications.data?.items ?? [];
  // While the panel is open its own response is authoritative; otherwise use the badge query.
  const unread = open ? notifications.data?.unread ?? 0 : count.data?.unread ?? 0;
  const label = useMemo(() => (unread > 99 ? '99+' : String(unread)), [unread]);

  function openItem(item: Notification) {
    if (!item.readAt) markRead.mutate(item.id);
    if (item.link) {
      setOpen(false);
      onNavigate(item.link);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
      >
        <Bell className="size-[18px]" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid min-w-[16px] place-items-center rounded-full bg-accent px-1 text-[9px] font-bold leading-4 text-accent-foreground">
            {label}
          </span>
        )}
      </button>

      {open && (
        <>
          <button type="button" className="fixed inset-0 z-30 cursor-default" aria-label="Close notifications" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-[360px] overflow-hidden rounded-lg border border-border bg-card shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <p className="text-xs font-semibold">Notifications</p>
              <button
                type="button"
                onClick={() => markAll.mutate()}
                disabled={unread === 0 || markAll.isPending}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                <CheckCheck className="size-3.5" /> Mark all read
              </button>
            </div>
            <div className="max-h-[380px] overflow-y-auto">
              {notifications.isLoading && <p className="px-4 py-8 text-center text-xs text-muted-foreground">Loading…</p>}
              {!notifications.isLoading && items.length === 0 && (
                <p className="px-4 py-8 text-center text-xs text-muted-foreground">Nothing yet. Activity on your programmes shows up here.</p>
              )}
              {items.map((item) => (
                <NotificationRow key={item.id} item={item} onOpen={openItem} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export { relativeTime };
