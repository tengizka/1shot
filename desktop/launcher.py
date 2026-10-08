import sys

if '--backup-local' in sys.argv:
    from desktop.upgrade_backup import main
    sys.exit(main(sys.argv[sys.argv.index('--backup-local') + 1:]))
elif '--smoke-test' in sys.argv:
    from desktop.smoke import main
    main(sys.argv[sys.argv.index('--smoke-test') + 1])
else:
    from desktop.app import main
    main()
