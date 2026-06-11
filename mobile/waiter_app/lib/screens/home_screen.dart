import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../models/table_summary.dart';
import '../state/auth_state.dart';
import 'order_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  HomePayload? _data;
  Object? _error;
  bool _loading = true;
  Timer? _poll;
  static const _pollEvery = Duration(seconds: 4);

  @override
  void initState() {
    super.initState();
    _refresh();
    _poll = Timer.periodic(_pollEvery, (_) => _refresh(silent: true));
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _refresh({bool silent = false}) async {
    if (!mounted) return;
    if (!silent) setState(() => _loading = true);
    final api = context.read<ApiClient>();
    try {
      final data = await api.home();
      if (!mounted) return;
      setState(() {
        _data = data;
        _error = null;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (e.isAuthError) {
        await context.read<AuthState>().signOutLocal();
        return;
      }
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _openOrder(TableSummary t) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => OrderScreen(
          tableId: t.id,
          tableNumber: t.tableNumber,
          initialOrderId: t.currentOrderId,
        ),
      ),
    );
    if (mounted) _refresh(silent: true);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final auth = context.watch<AuthState>();

    return Scaffold(
      appBar: AppBar(
        title: Text(_data?.settings.restaurantName ?? 'Tables'),
        actions: [
          IconButton(
            tooltip: 'Sign out',
            icon: const Icon(Icons.logout),
            onPressed: () async {
              await auth.signOut();
            },
          ),
        ],
      ),
      body: RefreshIndicator(onRefresh: () => _refresh(), child: _body(theme)),
      bottomNavigationBar: _data == null
          ? null
          : _StatusBar(
              tables: _data!.tables,
              identity: auth.identity?.name ?? '',
            ),
    );
  }

  Widget _body(ThemeData theme) {
    if (_loading && _data == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null && _data == null) {
      return ListView(
        children: [
          const SizedBox(height: 80),
          Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                children: [
                  Icon(
                    Icons.cloud_off_outlined,
                    size: 56,
                    color: theme.colorScheme.outline,
                  ),
                  const SizedBox(height: 16),
                  Text(
                    'Could not load tables',
                    style: theme.textTheme.titleMedium,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '$_error',
                    textAlign: TextAlign.center,
                    style: theme.textTheme.bodySmall,
                  ),
                  const SizedBox(height: 16),
                  FilledButton.tonal(
                    onPressed: () => _refresh(),
                    child: const Text('Retry'),
                  ),
                ],
              ),
            ),
          ),
        ],
      );
    }
    final tables = _data!.tables;
    if (tables.isEmpty) {
      return ListView(
        children: const [
          SizedBox(height: 80),
          Center(child: Text('No tables configured yet.')),
        ],
      );
    }
    return GridView.builder(
      padding: const EdgeInsets.all(12),
      gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
        maxCrossAxisExtent: 200,
        mainAxisSpacing: 12,
        crossAxisSpacing: 12,
        childAspectRatio: 0.92,
      ),
      itemCount: tables.length,
      itemBuilder: (ctx, i) => _TableCard(
        table: tables[i],
        currency: _data!.settings.currency,
        onTap: () => _openOrder(tables[i]),
      ),
    );
  }
}

class _TableCard extends StatelessWidget {
  final TableSummary table;
  final String currency;
  final VoidCallback onTap;
  const _TableCard({
    required this.table,
    required this.currency,
    required this.onTap,
  });

  Color _bgFor(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    if (table.openCallCount > 0) return cs.errorContainer;
    switch (table.status) {
      case 'occupied':
        return cs.primaryContainer;
      case 'reserved':
        return cs.tertiaryContainer;
      default:
        return cs.surfaceContainerHighest;
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final order = table.order;
    final hasCall = table.openCallCount > 0;
    final selfCount = order?.selfOrderCount ?? 0;

    return Material(
      color: _bgFor(context),
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Stack(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 14, 14, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          'T${table.tableNumber}',
                          style: theme.textTheme.headlineSmall?.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      Icon(
                        Icons.group_outlined,
                        size: 14,
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                      const SizedBox(width: 2),
                      Text(
                        '${table.capacity}',
                        style: theme.textTheme.bodySmall,
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  _statusChip(theme),
                  const Spacer(),
                  if (order != null) ...[
                    Text(
                      order.orderNumber,
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                    Text(
                      '$currency${order.total.toStringAsFixed(2)}',
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    Row(
                      children: [
                        Icon(
                          Icons.restaurant_menu,
                          size: 14,
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                        const SizedBox(width: 2),
                        Text(
                          '${order.itemCount}',
                          style: theme.textTheme.bodySmall,
                        ),
                        if (order.hasUnsentItems) ...[
                          const SizedBox(width: 8),
                          _badge(
                            context,
                            '${order.pendingKotCount} unsent',
                            theme.colorScheme.secondary,
                          ),
                        ],
                      ],
                    ),
                  ] else
                    Text(
                      'Tap to start order',
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                ],
              ),
            ),
            if (hasCall)
              Positioned(
                top: 8,
                right: 8,
                child: _CallBadge(count: table.openCallCount),
              ),
            if (selfCount > 0)
              Positioned(
                bottom: 8,
                right: 8,
                child: _SelfOrderBadge(count: selfCount),
              ),
          ],
        ),
      ),
    );
  }

  Widget _statusChip(ThemeData theme) {
    final label = table.status[0].toUpperCase() + table.status.substring(1);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: theme.colorScheme.onSurface.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(
        label,
        style: theme.textTheme.labelSmall?.copyWith(
          color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
        ),
      ),
    );
  }

  Widget _badge(BuildContext ctx, String text, Color bg) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(
        text,
        style: Theme.of(ctx).textTheme.labelSmall?.copyWith(
          color: Theme.of(ctx).colorScheme.onSecondary,
          fontSize: 10,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _CallBadge extends StatelessWidget {
  final int count;
  const _CallBadge({required this.count});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: theme.colorScheme.error,
        borderRadius: BorderRadius.circular(99),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.notifications_active,
            size: 12,
            color: theme.colorScheme.onError,
          ),
          const SizedBox(width: 4),
          Text(
            '$count',
            style: theme.textTheme.labelSmall?.copyWith(
              color: theme.colorScheme.onError,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _SelfOrderBadge extends StatelessWidget {
  final int count;
  const _SelfOrderBadge({required this.count});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: theme.colorScheme.tertiary,
        borderRadius: BorderRadius.circular(99),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.qr_code_2, size: 12, color: theme.colorScheme.onTertiary),
          const SizedBox(width: 3),
          Text(
            'QR $count',
            style: theme.textTheme.labelSmall?.copyWith(
              color: theme.colorScheme.onTertiary,
              fontSize: 10,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _StatusBar extends StatelessWidget {
  final List<TableSummary> tables;
  final String identity;
  const _StatusBar({required this.tables, required this.identity});

  @override
  Widget build(BuildContext context) {
    final occupied = tables.where((t) => t.status == 'occupied').length;
    final calls = tables.fold<int>(0, (s, t) => s + t.openCallCount);
    final selfOrders = tables.fold<int>(
      0,
      (s, t) => s + (t.order?.selfOrderCount ?? 0),
    );
    final df = DateFormat('h:mm a');
    final now = df.format(DateTime.now());
    final theme = Theme.of(context);
    return BottomAppBar(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12),
        child: Row(
          children: [
            Expanded(
              child: Wrap(
                spacing: 12,
                runSpacing: 4,
                children: [
                  _stat(
                    theme,
                    Icons.table_bar,
                    '$occupied/${tables.length} seated',
                  ),
                  if (calls > 0)
                    _stat(
                      theme,
                      Icons.notifications_active,
                      '$calls calls',
                      color: theme.colorScheme.error,
                    ),
                  if (selfOrders > 0)
                    _stat(
                      theme,
                      Icons.qr_code_2,
                      '$selfOrders QR lines',
                      color: theme.colorScheme.tertiary,
                    ),
                ],
              ),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  identity,
                  style: theme.textTheme.labelMedium?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
                Text(now, style: theme.textTheme.labelSmall),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _stat(ThemeData theme, IconData icon, String text, {Color? color}) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 16, color: color ?? theme.colorScheme.onSurface),
        const SizedBox(width: 4),
        Text(text, style: theme.textTheme.labelMedium?.copyWith(color: color)),
      ],
    );
  }
}
