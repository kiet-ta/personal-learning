import 'package:flutter/material.dart';

void main() {
  runApp(const LocalKnowledgeMobileApp());
}

class LocalKnowledgeMobileApp extends StatelessWidget {
  const LocalKnowledgeMobileApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Local Knowledge',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF285F63),
          brightness: Brightness.light,
        ),
        useMaterial3: true,
      ),
      home: const CompanionHomeScreen(),
    );
  }
}

class CompanionHomeScreen extends StatelessWidget {
  const CompanionHomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Learning Vault'),
        actions: [
          IconButton(
            tooltip: 'Pair desktop',
            onPressed: () {},
            icon: const Icon(Icons.qr_code_2),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            'Desktop is canonical',
            style: theme.textTheme.headlineMedium?.copyWith(
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Capture files, review due cards, and run lightweight search against the local cache.',
            style: theme.textTheme.bodyMedium,
          ),
          const SizedBox(height: 20),
          const _ActionTile(
            icon: Icons.upload_file,
            title: 'Capture asset',
            subtitle: 'Queue PDF, text, Markdown, or image for desktop ingest.',
          ),
          const _ActionTile(
            icon: Icons.school,
            title: 'Review due cards',
            subtitle: 'Send review events back to the desktop vault.',
          ),
          const _ActionTile(
            icon: Icons.search,
            title: 'Light search',
            subtitle: 'Search cached node summaries while away from desktop.',
          ),
          const _ActionTile(
            icon: Icons.sync_lock,
            title: 'Local sync',
            subtitle: 'Pair with short-lived token; no cloud relay in MVP.',
          ),
        ],
      ),
    );
  }
}

class _ActionTile extends StatelessWidget {
  const _ActionTile({
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: ListTile(
        leading: Icon(icon),
        title: Text(title),
        subtitle: Text(subtitle),
        trailing: const Icon(Icons.chevron_right),
        onTap: () {},
      ),
    );
  }
}
