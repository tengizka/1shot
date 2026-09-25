import sys

if '--smoke-test' in sys.argv:
    from desktop.smoke import main
    main(sys.argv[sys.argv.index('--smoke-test') + 1])
else:
    from desktop.app import main
    main()
