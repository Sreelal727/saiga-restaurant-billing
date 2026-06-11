/// Logged-in staff/admin identity returned by /api/mobile/login and /me.
class Identity {
  final String? staffId; // null for admin
  final String name;
  final String username;
  final String role;
  final bool isAdmin;

  const Identity({
    required this.staffId,
    required this.name,
    required this.username,
    required this.role,
    required this.isAdmin,
  });

  factory Identity.fromJson(Map<String, dynamic> json) => Identity(
    staffId: json['staff_id'] as String?,
    name: json['name'] as String? ?? '',
    username: json['username'] as String? ?? '',
    role: json['role'] as String? ?? 'waiter',
    isAdmin: json['is_admin'] as bool? ?? false,
  );

  Map<String, dynamic> toJson() => {
    'staff_id': staffId,
    'name': name,
    'username': username,
    'role': role,
    'is_admin': isAdmin,
  };
}
