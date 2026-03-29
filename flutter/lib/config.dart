import 'package:flutter/material.dart';

class AppConfig {
  static const String apiBaseUrl = 'https://purl-production.up.railway.app';
}

class AppColors {
  static const Color bg = Color(0xFFF5F0E8);
  static const Color bgSecondary = Color(0xFFEDE7DC);
  static const Color text = Color(0xFF2C2420);
  static const Color textSecondary = Color(0xFF6B5F55);
  static const Color textMuted = Color(0xFFA09488);
  static const Color accent = Color(0xFF7B6B8A);
  static const Color accentHover = Color(0xFF655678);
  static const Color border = Color(0x0F000000);
  static const Color tonePositive = Color(0xFF5A8A7A);
  static const Color toneCritic = Color(0xFFA85A4A);
  static const Color toneHold = Color(0xFF8A8A8A);

  // 다크 테마 (궤적용)
  static const Color nightBg = Color(0xFF121214);
  static const Color nightText = Color(0xFFD4CFC6);
  static const Color nightTextSecondary = Color(0xFF8A8580);
  static const Color nightTextMuted = Color(0xFF5A5550);
  static const Color nightBorder = Color(0x0FFFFFFF);
  static const Color nightAccent = Color(0xFFB8A9C8);

  static Color toneColor(String tone) {
    switch (tone) {
      case 'positive':
        return tonePositive;
      case 'critic':
        return toneCritic;
      case 'hold':
        return toneHold;
      default:
        return toneHold;
    }
  }

  static String toneLabel(String tone) {
    switch (tone) {
      case 'positive':
        return '공감';
      case 'critic':
        return '비판';
      case 'hold':
        return '보류';
      default:
        return '보류';
    }
  }
}
