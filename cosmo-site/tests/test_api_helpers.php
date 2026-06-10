<?php
putenv('IP_SALT=test-salt-123');           // env() reads getenv(); set before include
require_once __DIR__ . '/../includes/api.php';

section('ip_hash');
eq('deterministic', ip_hash('1.2.3.4'), ip_hash('1.2.3.4'));
check('differs by ip', ip_hash('1.2.3.4') !== ip_hash('1.2.3.5'));
eq('is sha256 hex (64 chars)', strlen(ip_hash('1.2.3.4')), 64);
check('salted (not bare sha256)', ip_hash('1.2.3.4') !== hash('sha256', '1.2.3.4'));

section('origin_host_matches');
check('same host ok', origin_host_matches('https://cosmo.app/x', 'https://cosmo.app'));
check('different host rejected', !origin_host_matches('https://evil.com', 'https://cosmo.app'));
check('empty origin allowed (no header)', origin_host_matches('', 'https://cosmo.app'));
check('empty site_url → skip (dev)', origin_host_matches('https://anything.com', ''));
// www vs apex must count as the same site (the live "Bad origin" bug: both hosts serve, no redirect).
check('www origin vs apex site_url ok', origin_host_matches('https://www.iamcosmo.in', 'https://iamcosmo.in'));
check('apex origin vs www site_url ok', origin_host_matches('https://iamcosmo.in/support.php', 'https://www.iamcosmo.in'));
check('www both sides ok', origin_host_matches('https://www.iamcosmo.in', 'https://www.iamcosmo.in'));
check('subdomain still rejected (not just www)', !origin_host_matches('https://evil.iamcosmo.in', 'https://iamcosmo.in'));
check('normalize_host strips www', normalize_host('www.iamcosmo.in') === 'iamcosmo.in');
check('normalize_host leaves apex', normalize_host('iamcosmo.in') === 'iamcosmo.in');

section('rate_window_start floors to bucket');
eq('600s bucket', rate_window_start(1718000123, 600), 1717999800);
