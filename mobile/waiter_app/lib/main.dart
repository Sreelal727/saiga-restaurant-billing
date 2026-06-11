import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'api/api_client.dart';
import 'screens/home_screen.dart';
import 'screens/login_screen.dart';
import 'state/auth_state.dart';

void main() {
  runApp(const WaiterApp());
}

/// Set at build time with `--dart-define=API_BASE_URL=https://...convex.cloud`.
/// Defaults to the local Convex dev HTTP endpoint so `flutter run` against a
/// running `convex dev` works out of the box (10.0.2.2 is the Android
/// emulator's host loopback).
const _defaultBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://10.0.2.2:3210',
);

class WaiterApp extends StatefulWidget {
  const WaiterApp({super.key});

  @override
  State<WaiterApp> createState() => _WaiterAppState();
}

class _WaiterAppState extends State<WaiterApp> {
  late final ApiClient _api;
  late final AuthState _auth;

  @override
  void initState() {
    super.initState();
    _api = ApiClient(baseUrl: _defaultBaseUrl);
    _auth = AuthState(api: _api);
    _auth.bootstrap();
  }

  @override
  void dispose() {
    _auth.dispose();
    _api.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        Provider<ApiClient>.value(value: _api),
        ChangeNotifierProvider<AuthState>.value(value: _auth),
      ],
      child: MaterialApp(
        title: 'Saiga Waiter',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          useMaterial3: true,
          colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(0xFF6750A4),
            brightness: Brightness.light,
          ),
        ),
        darkTheme: ThemeData(
          useMaterial3: true,
          colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(0xFF6750A4),
            brightness: Brightness.dark,
          ),
        ),
        home: const _AuthGate(),
      ),
    );
  }
}

class _AuthGate extends StatelessWidget {
  const _AuthGate();

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthState>();
    switch (auth.stage) {
      case AuthStage.loading:
        return const Scaffold(body: Center(child: CircularProgressIndicator()));
      case AuthStage.signedOut:
        return const LoginScreen();
      case AuthStage.signedIn:
        return const HomeScreen();
    }
  }
}
